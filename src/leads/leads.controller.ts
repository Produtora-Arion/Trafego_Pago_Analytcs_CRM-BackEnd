import { Controller, Get, Patch, Post, Delete, Param, Body, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeadsService, CreateLeadDto } from './leads.service';
import { GoogleAdsService } from '../google-ads/google-ads.service';
import { CrmStagesService } from '../crm-stages/crm-stages.service';
import { WebhookConfigService } from '../webhook-config/webhook-config.service';
import { SupabaseAuthGuard, AuthUser } from '../auth/supabase-auth.guard';

@Controller('leads')
@UseGuards(SupabaseAuthGuard)
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly googleAds: GoogleAdsService,
    private readonly crmStages: CrmStagesService,
    private readonly webhookConfig: WebhookConfigService,
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
  updateFields(@Param('id') id: string, @Body() body: any, @Req() req: any) {
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
      );
      if (success) {
        await this.leads.markConversionUploaded(lead.id);
      }
      return { ...lead, uploadSuccess: success, uploadDetail: detail };
    }

    return { ...lead, uploadSuccess: false, uploadDetail: 'Lead sem GCLID — não veio de anúncio rastreado' };
  }
}
