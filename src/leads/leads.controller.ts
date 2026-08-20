import { Controller, Get, Patch, Post, Delete, Param, Body, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeadsService, CreateLeadDto, UpdateLeadFieldsDto } from './leads.service';
import { GoogleAdsService } from '../google-ads/google-ads.service';
import { CrmStagesService } from '../crm-stages/crm-stages.service';
import { WebhookConfigService } from '../webhook-config/webhook-config.service';
import { LossReasonsService } from '../loss-reasons/loss-reasons.service';
import { SupabaseAuthGuard, AuthUser } from '../auth/supabase-auth.guard';

@Controller('leads')
@UseGuards(SupabaseAuthGuard)
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly googleAds: GoogleAdsService,
    private readonly crmStages: CrmStagesService,
    private readonly webhookConfig: WebhookConfigService,
    private readonly lossReasons: LossReasonsService,
    private readonly config: ConfigService,
  ) {}

  /** null para admin (acesso total), customerId do token para cliente */
  private tenant(req: any): string | null {
    const u = req.user as AuthUser | undefined;
    return u && u.role !== 'admin' ? u.customerId : null;
  }

  /** Cliente sempre força o próprio customerId (nunca confia no query param); admin pode listar tudo ou filtrar. */
  @Get()
  findAll(@Query('customerId') customerId: string | undefined, @Req() req: any) {
    return this.leads.findAll(this.tenant(req) ?? customerId);
  }

  /**
   * Funil simples do mês: quantos leads (que chegaram naquele mês) estão
   * hoje em cada etapa. Inclui etapas com zero leads pra manter a forma do
   * funil sempre completa, na mesma ordem das colunas do Kanban.
   */
  @Get('funnel')
  async getFunnel(
    @Query('customerId') customerId: string | undefined,
    @Query('month') month: string,
    @Req() req: any,
  ) {
    const effectiveCustomerId = this.tenant(req) ?? customerId;
    if (!effectiveCustomerId) throw new BadRequestException('customerId é obrigatório');
    if (!/^\d{4}-\d{2}$/.test(month || '')) throw new BadRequestException('month deve estar no formato YYYY-MM');

    const [stages, counts] = await Promise.all([
      this.crmStages.findAll(effectiveCustomerId),
      this.leads.getMonthlyFunnel(effectiveCustomerId, month),
    ]);

    const countMap = new Map(counts.map((c) => [c.stageId, c.count]));
    const total = counts.reduce((sum, c) => sum + c.count, 0);

    return {
      month,
      total,
      stages: stages.map((s) => ({ stageId: s.id, label: s.label, color: s.color, count: countMap.get(s.id) ?? 0 })),
    };
  }

  /** Converte um período do Google Ads (LAST_7_DAYS, THIS_MONTH, CUSTOM:from:to) num intervalo de datas real. */
  private periodToRange(period: string): { from: Date; to: Date } {
    const to = new Date();
    if (period.startsWith('CUSTOM:')) {
      const [, from, toStr] = period.split(':');
      return { from: new Date(`${from}T00:00:00.000Z`), to: new Date(`${toStr}T23:59:59.999Z`) };
    }
    const days = period === 'THIS_MONTH' || period === 'LAST_MONTH'
      ? 31
      : Number(period.replace(/\D/g, '')) || 7;
    const from = new Date(to);
    from.setDate(from.getDate() - days);
    return { from, to };
  }

  /**
   * Cruza o desempenho de cada palavra-chave (dados do Google Ads) com os
   * leads REAIS do CRM daquele mesmo período — pra além do que o Google
   * reporta como "conversions" (que pode estar contando o sinal errado,
   * como descobrimos na conta da Patricia). Mostra, por keyword: quantos
   * leads de verdade ela trouxe, e marca como "fantasma" quem gastou sem
   * trazer nenhum.
   */
  @Get('keywords-real/:customerId')
  async getKeywordsReal(
    @Param('customerId') customerIdParam: string,
    @Query('campaignId') campaignId: string | undefined,
    @Query('period') period = 'LAST_30_DAYS',
    @Req() req: any,
  ) {
    const customerId = this.tenant(req) ?? customerIdParam;
    if (!customerId) throw new BadRequestException('customerId é obrigatório');

    const { from, to } = this.periodToRange(period);

    const [keywordRows, leadsComGclid] = await Promise.all([
      this.googleAds.getKeywordPerformance(customerId, campaignId, period),
      this.leads.findWithGclidInRange(customerId, from, to),
    ]);

    const brasiliaDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const keywordMap = await this.googleAds.resolveKeywordsForClicks(
      customerId,
      leadsComGclid.map((l) => ({ gclid: l.gclid, date: brasiliaDate(l.firstContactAt) })),
    );

    // Agrega "quantos leads reais" e "quantos viraram conversão de verdade"
    // por palavra-chave (texto + tipo de correspondência).
    const leadsPorKeyword = new Map<string, { leads: number; convertidos: number }>();
    let naoIdentificados = 0;
    for (const lead of leadsComGclid) {
      const kw = keywordMap.get(lead.gclid);
      if (!kw) { naoIdentificados++; continue; }
      const key = `${kw.texto}|${kw.tipo_correspondencia}`;
      const acc = leadsPorKeyword.get(key) ?? { leads: 0, convertidos: 0 };
      acc.leads++;
      if (lead.convertedAt) acc.convertidos++;
      leadsPorKeyword.set(key, acc);
    }

    const resultado = keywordRows.map((r) => {
      const key = `${r.palavra_chave}|${r.tipo_correspondencia}`;
      const agg = leadsPorKeyword.get(key);
      const leadsReais = agg?.leads ?? 0;
      const custoNumero = Number(r.custo.replace('R$', '').replace(',', '.').trim()) || 0;
      return {
        ...r,
        leads_reais: leadsReais,
        convertidos_reais: agg?.convertidos ?? 0,
        custo_por_lead_real: leadsReais > 0 ? `R$ ${(custoNumero / leadsReais).toFixed(2)}` : null,
        fantasma: custoNumero > 0 && leadsReais === 0,
      };
    });

    return {
      periodo: period,
      keywords: resultado,
      leads_nao_identificados: naoIdentificados,
    };
  }

  /** Cliente sempre força o próprio customerId (nunca confia no body); admin pode informar qualquer um. */
  @Post()
  create(@Body() body: CreateLeadDto, @Req() req: any) {
    const tenantId = this.tenant(req);
    if (tenantId) body.customerId = tenantId;
    return this.leads.upsertFromWebhook(body);
  }

  @Delete(':id')
  deleteById(@Param('id') id: string, @Req() req: any) {
    return this.leads.deleteById(Number(id), this.tenant(req));
  }

  /** Edição manual dos campos do lead (contato, UTMs, valor da conversão etc.) no modal de rastreamento */
  @Patch(':id')
  updateFields(@Param('id') id: string, @Body() body: UpdateLeadFieldsDto, @Req() req: any) {
    return this.leads.updateFields(Number(id), body, this.tenant(req));
  }

  /** Substitui a lista inteira de lembretes do lead — máximo 3 */
  @Patch(':id/reminders')
  updateReminders(@Param('id') id: string, @Body('reminders') reminders: any[], @Req() req: any) {
    if (!Array.isArray(reminders) || reminders.length > 3) {
      throw new BadRequestException('Máximo de 3 lembretes por lead');
    }
    return this.leads.updateReminders(Number(id), JSON.stringify(reminders), this.tenant(req));
  }

  /**
   * Move o lead para outra etapa pelo ID (imutável) — nunca pelo nome.
   * findById() já garante que a etapa pertence ao tenant certo.
   */
  @Patch(':id/stage')
  async updateStage(@Param('id') id: string, @Body('stageId') stageId: number, @Req() req: any) {
    const tenantId = this.tenant(req);
    const stage = await this.crmStages.findById(Number(stageId), tenantId);
    return this.leads.updateStage(Number(id), stage.id, stage.label, tenantId);
  }

  /**
   * Move o lead pra etapa fixa "Perdido", exigindo um motivo pré-cadastrado
   * (ativo e do próprio tenant). findById()/findById() garantem que tanto a
   * etapa quanto o motivo pertencem ao cliente certo.
   */
  @Post(':id/lose')
  async lose(
    @Param('id') id: string,
    @Body('stageId') stageId: number,
    @Body('lossReasonId') lossReasonId: number,
    @Req() req: any,
  ) {
    const tenantId = this.tenant(req);
    if (!lossReasonId) throw new BadRequestException('lossReasonId é obrigatório');

    const stage = await this.crmStages.findById(Number(stageId), tenantId);
    if (stage.kind !== 'lost') throw new BadRequestException('A etapa informada não é a etapa fixa "Perdido"');

    const reason = await this.lossReasons.findById(Number(lossReasonId), tenantId);
    if (!reason.active) throw new BadRequestException('Este motivo está desativado — escolha outro');

    return this.leads.markLost(Number(id), stage.id, stage.label, reason.id, tenantId);
  }

  @Post(':id/convert')
  async convert(
    @Param('id') id: string,
    @Req() req: any,
    @Body('value') value: number,
    @Body('customerId') customerIdBody: string,
    @Body('stageId') stageId?: number,
  ) {
    const tenantId = this.tenant(req);
    // Cliente: sempre a própria conta (nunca confia no body). Admin: o que veio
    // no body, com a env var como último fallback legado.
    const customerId = tenantId || customerIdBody || this.config.get('GA_CONVERSION_CUSTOMER_ID', '');

    // Cada cliente tem sua própria conta Google Ads e sua própria ação de
    // conversão — nunca aceita esse valor vindo do body (um cliente poderia
    // apontar pra ação de conversão de outra conta). Resolve sempre pelo
    // customerId de destino; a env var só cobre o caso legado de quem nunca
    // configurou nada em ⚡ Webhook.
    const conversionActionId =
      (await this.webhookConfig.getConversionActionId(customerId)) ||
      this.config.get('GA_CONVERSION_ACTION_ID', '');

    let stageLabel: string | undefined;
    let resolvedStageId: number | undefined;
    if (stageId) {
      const stage = await this.crmStages.findById(Number(stageId), tenantId);
      stageLabel = stage.label;
      resolvedStageId = stage.id;
    }

    const lead = await this.leads.markConverted(
      Number(id),
      value ?? 0,
      customerId,
      conversionActionId,
      tenantId,
      resolvedStageId,
      stageLabel,
    );

    if (lead.gclid) {
      const { success, detail } = await this.googleAds.uploadOfflineConversion(
        customerId,
        lead.gclid,
        conversionActionId,
        lead.convertedAt,
        lead.conversionValue ?? 0,
        lead.phone,
      );
      if (success) {
        await this.leads.markConversionUploaded(lead.id);
      }
      // O detalhe bruto do erro (estrutura de conta, IDs internos do Google Ads)
      // já foi logado no servidor por uploadOfflineConversion — pro cliente final
      // só uma mensagem genérica, nunca a resposta crua da API do Google.
      const uploadDetail = success
        ? detail
        : 'Não foi possível registrar a conversão no Google Ads. Nossa equipe foi notificada.';
      return { ...lead, uploadSuccess: success, uploadDetail };
    }

    return { ...lead, uploadSuccess: false, uploadDetail: 'Lead sem GCLID — não veio de anúncio rastreado' };
  }
}
