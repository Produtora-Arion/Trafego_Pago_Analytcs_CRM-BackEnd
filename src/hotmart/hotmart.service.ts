import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { HotmartClickRef } from './hotmart-click-ref.entity';
import { HotmartSale } from './hotmart-sale.entity';
import { WebhookConfigService } from '../webhook-config/webhook-config.service';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

/** Compara em tempo constante — mesmo padrão usado pra x-api-key em outros lugares do backend. */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

@Injectable()
export class HotmartService {
  private readonly logger = new Logger('Hotmart');

  constructor(
    @InjectRepository(HotmartClickRef) private readonly clickRepo: Repository<HotmartClickRef>,
    @InjectRepository(HotmartSale) private readonly saleRepo: Repository<HotmartSale>,
    private readonly webhookConfig: WebhookConfigService,
  ) {}

  /**
   * Chamado pelo site do cliente ao carregar a página com um fbclid na URL —
   * o fbclid é grande demais pra caber no campo "src" do link de checkout da
   * Hotmart, então guardamos ele aqui e devolvemos um código curto pra grudar
   * no link no lugar. Quando a venda for aprovada, a Hotmart devolve esse
   * código de volta e a gente resgata o fbclid de verdade.
   */
  async registerClick(customerId: string, fbclid: string): Promise<string> {
    const ref = randomBytes(5).toString('hex'); // 10 caracteres, cabe folgado no "src"
    await this.clickRepo.save(this.clickRepo.create({ id: ref, customerId, fbclid }));
    return ref;
  }

  /**
   * Processa um aviso de webhook da Hotmart. Sempre retorna 200 (mesmo em
   * erro de validação/parsing) — devolver erro faz a Hotmart re-tentar em
   * loop e pode até desativar o webhook depois de falhas repetidas. Qualquer
   * problema fica só registrado no log do servidor pra investigar depois.
   */
  async processPurchase(
    customerId: string,
    hottokHeader: string | undefined,
    body: any,
  ): Promise<{ ok: boolean; detail: string }> {
    const config = await this.webhookConfig.getHotmartConfig(customerId);

    if (!config.hottok) {
      this.logger.warn(`[${customerId}] Webhook recebido mas hottok não configurado — ignorado.`);
      return { ok: false, detail: 'Hottok não configurado para este cliente' };
    }
    if (!hottokHeader || !safeCompare(hottokHeader, config.hottok)) {
      this.logger.warn(`[${customerId}] Webhook recebido com hottok inválido — possível tentativa forjada, ignorado.`);
      return { ok: false, detail: 'Hottok inválido' };
    }

    // Extração defensiva: schema da Hotmart não foi 100% confirmado contra um
    // payload real ainda — guarda o bruto sempre, pra corrigir os campos
    // certos assim que o primeiro evento de teste/venda real chegar.
    const event = body?.event ?? null;
    const data = body?.data ?? {};
    const purchase = data?.purchase ?? {};
    const buyer = data?.buyer ?? {};
    const status: string | undefined = purchase?.status;

    const isApproved = event === 'PURCHASE_APPROVED' || status === 'APPROVED' || status === 'COMPLETE';
    if (!isApproved) {
      this.logger.log(`[${customerId}] Webhook recebido (evento: ${event}, status: ${status}) — não é compra aprovada, ignorado.`);
      return { ok: true, detail: `Evento ${event ?? 'desconhecido'} ignorado (não é compra aprovada)` };
    }

    const transactionId: string | null = purchase?.transaction ?? body?.id ?? null;
    const value = Number(purchase?.price?.value ?? purchase?.full_price?.value ?? 0);
    const currency: string = purchase?.price?.currency_value ?? purchase?.full_price?.currency_value ?? 'BRL';
    const ref: string | null = purchase?.origin?.src ?? data?.origin?.src ?? null;
    const buyerName: string | null = buyer?.name ?? null;
    const buyerEmail: string | null = buyer?.email ?? null;

    if (!transactionId) {
      this.logger.error(`[${customerId}] Webhook de compra aprovada sem ID de transação — payload inesperado, guardado bruto pra investigar.`);
      await this.saleRepo.save(this.saleRepo.create({
        customerId, transactionId: `sem-id-${Date.now()}`, buyerName, buyerEmail, value, currency,
        rawPayload: JSON.stringify(body),
      }));
      return { ok: false, detail: 'Payload sem ID de transação identificável' };
    }

    // Idempotência: a Hotmart pode reenviar o mesmo webhook mais de uma vez.
    const already = await this.saleRepo.findOne({ where: { customerId, transactionId } });
    if (already) {
      return { ok: true, detail: 'Venda já processada anteriormente (idempotência)' };
    }

    // "ref" pode ser duas coisas: um código gerado por um clique de anúncio
    // (resolve pra um fbclid de verdade na tabela) ou uma marcação fixa que
    // o site já manda pronta no link (ex: "instagram-bio") — não existe na
    // tabela, mas ainda diz de onde veio.
    const clickRef = ref ? await this.clickRepo.findOne({ where: { id: ref } }) : null;
    const fbclid = clickRef?.fbclid ?? null;
    const channel = fbclid ? 'Anúncio Meta' : ref || null;

    const sale = this.saleRepo.create({
      customerId, transactionId, buyerName, buyerEmail, value, currency, fbclid, channel,
      rawPayload: JSON.stringify(body),
    });

    if (fbclid || buyerEmail) {
      if (config.pixelId && config.metaAccessToken) {
        const result = await this.sendPurchaseToMeta(config.pixelId, config.metaAccessToken, {
          fbclid, email: buyerEmail, value, currency, eventId: transactionId,
        });
        sale.metaSent = result.success;
        sale.metaSentDetail = result.detail;
      } else {
        sale.metaSentDetail = 'Pixel ID ou token do Meta não configurado para este cliente';
      }
    } else {
      sale.metaSentDetail = 'Sem fbclid nem email — venda sem como ligar a um clique/pessoa rastreada';
    }

    await this.saleRepo.save(sale);
    return { ok: true, detail: `Venda ${transactionId} registrada — Meta: ${sale.metaSent ? 'enviado' : 'não enviado (' + sale.metaSentDetail + ')'}` };
  }

  /** Envia o evento de Compra real pro Meta via Conversions API (servidor a servidor). */
  private async sendPurchaseToMeta(
    pixelId: string,
    accessToken: string,
    params: { fbclid: string | null; email: string | null; value: number; currency: string; eventId: string },
  ): Promise<{ success: boolean; detail: string }> {
    const userData: Record<string, unknown> = {};
    // Formato exigido pelo Meta pro cookie/parâmetro de clique: fb.1.<timestamp>.<fbclid>
    if (params.fbclid) userData.fbc = `fb.1.${Date.now()}.${params.fbclid}`;
    if (params.email) userData.em = [sha256Hex(params.email)];

    if (Object.keys(userData).length === 0) {
      return { success: false, detail: 'Sem fbclid nem email — nada pra identificar a pessoa/clique' };
    }

    const body = {
      data: [{
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: params.eventId, // dedup — evita contar duas vezes se um dia também tiver pixel no navegador
        action_source: 'website',
        user_data: userData,
        custom_data: { value: params.value, currency: params.currency },
      }],
    };

    try {
      const res = await fetch(
        `https://graph.facebook.com/v20.0/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
      const result = await res.json() as any;
      if (!res.ok || result.error) {
        this.logger.error(`Falha ao enviar Purchase pro Meta (HTTP ${res.status}): ${JSON.stringify(result)}`);
        return { success: false, detail: JSON.stringify(result) };
      }
      return { success: true, detail: JSON.stringify(result) };
    } catch (err) {
      this.logger.error('Erro de rede ao chamar a Conversions API do Meta', (err as Error)?.stack);
      return { success: false, detail: (err as Error)?.message ?? 'Erro de rede' };
    }
  }

  /** Vendas registradas de um cliente — pra exibir no CRM. */
  async listSales(customerId: string, limit = 100): Promise<HotmartSale[]> {
    return this.saleRepo.find({ where: { customerId }, order: { createdAt: 'DESC' }, take: limit });
  }
}
