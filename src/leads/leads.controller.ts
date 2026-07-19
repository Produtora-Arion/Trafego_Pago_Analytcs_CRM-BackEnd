import { Controller, Get, Patch, Post, Delete, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeadsService, CreateLeadDto } from './leads.service';
import { GoogleAdsService } from '../google-ads/google-ads.service';
import { CrmStagesService } from '../crm-stages/crm-stages.service';
import { SupabaseAuthGuard, AuthUser } from '../auth/supabase-auth.guard';

@Controller('leads')
@UseGuards(SupabaseAuthGuard)
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly googleAds: GoogleAdsService,
    private readonly crmStages: CrmStagesService,
    private readonly config: ConfigService,
  ) {}

  /** null para admin (acesso total), customerId do token para cliente */
  private tenant(req: any): string | null {
    const u = req.user as AuthUser | undefined;
    return u && u.role !== 'admin' ? u.customerId : null;
  }

  @Get()
  findAll(@Query('customerId') customerId?: string) {
    return this.leads.findAll(customerId);
  }

  @Post()
  create(@Body() body: CreateLeadDto) {
    return this.leads.upsertFromWebhook(body);
  }

  @Delete(':id')
  deleteById(@Param('id') id: string, @Req() req: any) {
    return this.leads.deleteById(Number(id), this.tenant(req));
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
    @Body('conversionActionId') conversionActionIdBody: string,
    @Body('stageId') stageId?: number,
  ) {
    const tenantId = this.tenant(req);
    const customerId = customerIdBody || this.config.get('GA_CONVERSION_CUSTOMER_ID', '');
    const conversionActionId = conversionActionIdBody || this.config.get('GA_CONVERSION_ACTION_ID', '');

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
