import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { HotmartClickRef } from './hotmart-click-ref.entity';
import { HotmartSale } from './hotmart-sale.entity';
import { WebhookConfigService } from '../webhook-config/webhook-config.service';
import { LeadsService } from '../leads/leads.service';
import { CrmStagesService } from '../crm-stages/crm-stages.service';
import { LossReasonsService } from '../loss-reasons/loss-reasons.service';
import { Lead } from '../leads/lead.entity';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

/** Compara em tempo constante — mesmo padrão usado pra x-api-key em outros lugares do backend. */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Pra onde cada evento da Hotmart deve mover o card no CRM:
 * - 'won'/'lost' usam as etapas fixas Ganho/Perdido que toda conta já tem.
 * - 'pending' são situações que ainda pedem ação (cobrar boleto, recuperar
 *   carrinho) — cada uma ganha sua própria etapa, criada automaticamente na
 *   conta do cliente na primeira vez que o evento aparecer.
 * Evento não mapeado aqui = ignorado (mesmo comportamento de sempre, seguro).
 */
type LeadOutcome = { kind: 'won' | 'lost' | 'pending'; stageLabel: string; lossReasonLabel?: string };

const EVENT_OUTCOMES: Record<string, LeadOutcome> = {
  // Compra aprovada / completa — venda de fato, card vai pra Ganho (+ manda pro Meta)
  PURCHASE_APPROVED: { kind: 'won', stageLabel: 'Ganho' },
  PURCHASE_COMPLETE: { kind: 'won', stageLabel: 'Ganho' },
  // Situações que ainda pedem ação da Fabi (cobrar, recuperar) — não são nem
  // venda ganha nem perdida ainda, por isso ganham etapa própria.
  PURCHASE_BILLET_PRINTED: { kind: 'pending', stageLabel: 'Aguardando Pagamento (Hotmart)' },
  PURCHASE_DELAYED: { kind: 'pending', stageLabel: 'Pagamento Atrasado (Hotmart)' },
  PURCHASE_PROTEST: { kind: 'pending', stageLabel: 'Pedido de Reembolso (Hotmart)' },
  PURCHASE_OUT_OF_SHOPPING_CART: { kind: 'pending', stageLabel: 'Carrinho Abandonado (Hotmart)' },
  // Venda que não vingou — card vai pra Perdido, já com o motivo certo.
  PURCHASE_CANCELED: { kind: 'lost', stageLabel: 'Perdido', lossReasonLabel: 'Cancelada (Hotmart)' },
  PURCHASE_REFUNDED: { kind: 'lost', stageLabel: 'Perdido', lossReasonLabel: 'Reembolsada (Hotmart)' },
  PURCHASE_CHARGEBACK: { kind: 'lost', stageLabel: 'Perdido', lossReasonLabel: 'Chargeback (Hotmart)' },
  PURCHASE_EXPIRED: { kind: 'lost', stageLabel: 'Perdido', lossReasonLabel: 'Boleto expirado (Hotmart)' },
  SUBSCRIPTION_CANCELLATION: { kind: 'lost', stageLabel: 'Perdido', lossReasonLabel: 'Assinatura cancelada (Hotmart)' },
  // Troca de plano, atualização de data de cobrança, primeiro acesso, módulo
  // completo e dados logísticos ficam de fora de propósito — não são estados
  // de negociação (a pessoa já é cliente ou é só um detalhe de conta), então
  // não fazem sentido movendo o card entre etapas. Chegam aqui e são
  // ignorados com segurança, igual qualquer evento não mapeado.
};

@Injectable()
export class HotmartService {
  private readonly logger = new Logger('Hotmart');

  constructor(
    @InjectRepository(HotmartClickRef) private readonly clickRepo: Repository<HotmartClickRef>,
    @InjectRepository(HotmartSale) private readonly saleRepo: Repository<HotmartSale>,
    private readonly webhookConfig: WebhookConfigService,
    private readonly leads: LeadsService,
    private readonly crmStages: CrmStagesService,
    private readonly lossReasons: LossReasonsService,
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

  /** Resolve o evento pro tipo de etapa do CRM — por nome do evento, com
   * fallback pelo campo "status" pra payloads sem "event" claro. */
  private resolveOutcome(event: string | null, status: string | undefined): LeadOutcome | null {
    if (event && EVENT_OUTCOMES[event]) return EVENT_OUTCOMES[event];
    if (status === 'APPROVED' || status === 'COMPLETE') return EVENT_OUTCOMES.PURCHASE_APPROVED;
    if (status === 'CANCELED' || status === 'CANCELLED') return EVENT_OUTCOMES.PURCHASE_CANCELED;
    if (status === 'REFUNDED') return EVENT_OUTCOMES.PURCHASE_REFUNDED;
    return null;
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

    const outcome = this.resolveOutcome(event, status);
    if (!outcome) {
      this.logger.log(`[${customerId}] Webhook recebido (evento: ${event}, status: ${status}) — sem etapa mapeada no CRM, ignorado.`);
      return { ok: true, detail: `Evento ${event ?? 'desconhecido'} ignorado (sem etapa mapeada no CRM)` };
    }

    const transactionId: string | null = purchase?.transaction ?? body?.id ?? null;
    const value = Number(purchase?.price?.value ?? purchase?.full_price?.value ?? 0);
    const currency: string = purchase?.price?.currency_value ?? purchase?.full_price?.currency_value ?? 'BRL';
    const ref: string | null = purchase?.origin?.src ?? data?.origin?.src ?? null;
    const buyerName: string | null = buyer?.name ?? null;
    const buyerEmail: string | null = buyer?.email ?? null;
    // Hotmart nem sempre manda telefone — quando manda, aparece num desses campos
    // dependendo da versão do checkout; sem nenhum deles, o lead ainda entra só com e-mail.
    const buyerPhone: string | null = buyer?.checkout_phone ?? buyer?.phone ?? null;
    const productName: string | null = data?.product?.name ?? null;

    // "ref" pode ser duas coisas: um código gerado por um clique de anúncio
    // (resolve pra um fbclid de verdade na tabela) ou uma marcação fixa que
    // o site já manda pronta no link (ex: "instagram-bio") — não existe na
    // tabela, mas ainda diz de onde veio.
    const clickRef = ref ? await this.clickRepo.findOne({ where: { id: ref } }) : null;
    const fbclid = clickRef?.fbclid ?? null;

    // ── CRM: roda pra QUALQUER evento mapeado (aprovada, cancelada, boleto
    // pendente, carrinho abandonado...) — não só pra venda aprovada. É o que
    // dá pra a Fabi acompanhar e agir em cada situação, não só ver o resultado
    // final. Nunca derruba o resto do processamento se falhar. ──
    let leadDetail = 'não vinculado';
    try {
      const lead = await this.routeLeadStage(customerId, outcome, {
        buyerName, buyerEmail, buyerPhone, fbclid, productName, value,
      });
      leadDetail = lead ? `card #${lead.id} → etapa "${lead.status}"` : 'etapa correspondente não encontrada/criada';
    } catch (err) {
      this.logger.error(`[${customerId}] Falha ao vincular evento ${event} a um lead no CRM`, (err as Error)?.stack);
      leadDetail = 'erro ao vincular (veja o log)';
    }

    // ── Venda + Conversions API do Meta: só pra compra de fato aprovada — o
    // resto (boleto pendente, cancelamento etc.) já foi refletido no CRM acima,
    // mas não é uma "venda" pra métrica nem deve virar Purchase pro Meta. ──
    if (outcome.kind !== 'won') {
      return { ok: true, detail: `Evento ${event} processado — CRM: ${leadDetail}` };
    }

    if (!transactionId) {
      this.logger.error(`[${customerId}] Webhook de compra aprovada sem ID de transação — payload inesperado, guardado bruto pra investigar.`);
      await this.saleRepo.save(this.saleRepo.create({
        customerId, transactionId: `sem-id-${Date.now()}`, buyerName, buyerEmail, value, currency,
        rawPayload: JSON.stringify(body),
      }));
      return { ok: false, detail: `Payload sem ID de transação identificável — CRM: ${leadDetail}` };
    }

    // Idempotência: a Hotmart pode reenviar o mesmo webhook mais de uma vez.
    const already = await this.saleRepo.findOne({ where: { customerId, transactionId } });
    if (already) {
      return { ok: true, detail: `Venda já processada anteriormente (idempotência) — CRM: ${leadDetail}` };
    }

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

    return {
      ok: true,
      detail: `Venda ${transactionId} registrada — Meta: ${sale.metaSent ? 'enviado' : 'não enviado (' + sale.metaSentDetail + ')'} — CRM: ${leadDetail}`,
    };
  }

  /**
   * Cria (ou reaproveita, pelo mesmo telefone/e-mail) o card da compradora no
   * CRM e move ele pra etapa correspondente ao evento atual — sempre reflete
   * o status mais recente, mesmo que o card já existisse numa etapa diferente
   * (ex: estava em "Aguardando Pagamento" e agora a compra foi aprovada, ou
   * estava "Ganho" e a compra foi reembolsada depois).
   *
   * Etapas de "Ganho"/"Perdido" já existem em toda conta (findAll cria as 4
   * padrão na primeira chamada). Etapas de situação pendente (boleto, carrinho
   * abandonado etc.) são criadas automaticamente na primeira vez que aparecem.
   */
  private async routeLeadStage(
    customerId: string,
    outcome: LeadOutcome,
    params: {
      buyerName: string | null; buyerEmail: string | null; buyerPhone: string | null;
      fbclid: string | null; productName: string | null; value: number;
    },
  ): Promise<Lead | null> {
    const stages = await this.crmStages.findAll(customerId);
    let stage =
      outcome.kind === 'won' ? stages.find(s => s.kind === 'won') :
      outcome.kind === 'lost' ? stages.find(s => s.kind === 'lost') :
      stages.find(s => s.label === outcome.stageLabel);

    // Etapa pendente ainda não existe nesta conta — cria agora, no fim do board.
    if (!stage && outcome.kind === 'pending') {
      stage = await this.crmStages.create(customerId, outcome.stageLabel, '#f59e0b', false, false);
    }
    if (!stage) return null;

    const lead = await this.leads.upsertFromWebhook({
      customerId,
      name: params.buyerName ?? undefined,
      email: params.buyerEmail ?? undefined,
      phone: params.buyerPhone ?? undefined,
      fbclid: params.fbclid ?? undefined,
      utmSource: 'hotmart',
      formChoice: params.productName ?? undefined,
      status: stage.label,
      stageId: stage.id,
    });

    // upsertFromWebhook só usa status/stageId na criação do card — se ele já
    // existia (mesma pessoa, evento anterior), os métodos abaixo garantem que
    // é movido pra etapa atual mesmo assim. Cada um devolve o lead já
    // atualizado — precisa retornar ESSE, não o `lead` de cima (que ainda
    // reflete o estado de antes da movimentação).
    if (outcome.kind === 'won') {
      return this.leads.markConverted(lead.id, params.value, customerId, '', null, stage.id, stage.label);
    }
    if (outcome.kind === 'lost') {
      const reason = await this.findOrCreateLossReason(customerId, outcome.lossReasonLabel!);
      return this.leads.markLost(lead.id, stage.id, stage.label, reason.id, null);
    }
    return this.leads.updateStage(lead.id, stage.id, stage.label, null);
  }

  /** Reaproveita o motivo de perda pelo nome se já existir nesta conta, senão cria. */
  private async findOrCreateLossReason(customerId: string, label: string) {
    const reasons = await this.lossReasons.findAll(customerId);
    return reasons.find(r => r.label === label) ?? this.lossReasons.create(customerId, label);
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
