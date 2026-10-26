import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { MetaAdsService } from './meta-ads.service';
import { WebhookConfigService } from '../webhook-config/webhook-config.service';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

/**
 * Cada cliente tem seu próprio Business Manager no Meta — não existe uma MCC
 * central como no Google Ads. Por isso toda rota é escopada por customerId: o
 * token certo é resolvido aqui (nunca é fixo/global) antes de chamar o service.
 *
 * Sem AdminOnlyGuard de propósito — igual ao Google, o cliente deve enxergar
 * os dados da própria conta (isolamento por customerId já vem do
 * SupabaseAuthGuard). Com AdminOnlyGuard aqui, nenhum login de cliente
 * conseguia ver a aba Meta, mesmo com Meta Ads configurado na conta dele.
 */
@Controller('meta')
@UseGuards(SupabaseAuthGuard)
export class MetaAdsController {
  constructor(
    private readonly meta: MetaAdsService,
    private readonly webhookConfig: WebhookConfigService,
  ) {}

  private async resolveToken(customerId: string): Promise<string> {
    const { accessToken } = await this.webhookConfig.getMetaConfig(customerId);
    if (!accessToken) {
      throw new BadRequestException(
        'Este cliente ainda não tem um token do Meta configurado (⚡ Webhook → Meta Ads).',
      );
    }
    return accessToken;
  }

  @Get(':customerId/accounts')
  async listAccounts(@Param('customerId') customerId: string) {
    const token = await this.resolveToken(customerId);
    return this.meta.listAdAccounts(token);
  }

  @Get(':customerId/:accountId/overview')
  async getOverview(
    @Param('customerId') customerId: string,
    @Param('accountId') accountId: string,
    @Query('period') period = 'LAST_7_DAYS',
  ) {
    const token = await this.resolveToken(customerId);
    return this.meta.getAccountOverview(token, accountId, period);
  }

  @Get(':customerId/:accountId/campaigns')
  async listCampaigns(
    @Param('customerId') customerId: string,
    @Param('accountId') accountId: string,
    @Query('period') period = 'LAST_7_DAYS',
  ) {
    const token = await this.resolveToken(customerId);
    return this.meta.listCampaigns(token, accountId, period);
  }

  @Get(':customerId/:accountId/campaigns/:campaignId/adsets')
  async listAdSets(
    @Param('customerId') customerId: string,
    @Param('accountId') accountId: string,
    @Param('campaignId') campaignId: string,
    @Query('period') period = 'LAST_7_DAYS',
  ) {
    const token = await this.resolveToken(customerId);
    return this.meta.listAdSets(token, accountId, campaignId, period);
  }

  @Get(':customerId/:accountId/campaigns/:campaignId/adsets/:adSetId/ads')
  async listAds(
    @Param('customerId') customerId: string,
    @Param('accountId') accountId: string,
    @Param('adSetId') adSetId: string,
    @Query('period') period = 'LAST_7_DAYS',
  ) {
    const token = await this.resolveToken(customerId);
    return this.meta.listAds(token, accountId, adSetId, period);
  }

  @Get(':customerId/:accountId/campaigns/:campaignId/demographics')
  async getDemographics(
    @Param('customerId') customerId: string,
    @Param('accountId') accountId: string,
    @Param('campaignId') campaignId: string,
    @Query('period') period = 'LAST_30_DAYS',
  ) {
    const token = await this.resolveToken(customerId);
    return this.meta.getDemographics(token, accountId, campaignId, period);
  }

  @Get(':customerId/:accountId/campaigns/:campaignId/day-of-week')
  async getDayOfWeek(
    @Param('customerId') customerId: string,
    @Param('accountId') accountId: string,
    @Param('campaignId') campaignId: string,
    @Query('period') period = 'LAST_30_DAYS',
  ) {
    const token = await this.resolveToken(customerId);
    return this.meta.getDayOfWeek(token, accountId, campaignId, period);
  }

  @Get(':customerId/:accountId/campaigns/:campaignId/devices')
  async getDevices(
    @Param('customerId') customerId: string,
    @Param('accountId') accountId: string,
    @Param('campaignId') campaignId: string,
    @Query('period') period = 'LAST_30_DAYS',
  ) {
    const token = await this.resolveToken(customerId);
    return this.meta.getDevices(token, accountId, campaignId, period);
  }

  @Get(':customerId/:accountId/campaigns/:campaignId/placements')
  async getPlacements(
    @Param('customerId') customerId: string,
    @Param('accountId') accountId: string,
    @Param('campaignId') campaignId: string,
    @Query('period') period = 'LAST_30_DAYS',
  ) {
    const token = await this.resolveToken(customerId);
    return this.meta.getPlacements(token, accountId, campaignId, period);
  }
}
