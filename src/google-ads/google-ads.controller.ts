import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { GoogleAdsService } from './google-ads.service';
import { WebhookConfigService } from '../webhook-config/webhook-config.service';
import { SupabaseAuthGuard, AuthUser } from '../auth/supabase-auth.guard';

@Controller('ads')
@UseGuards(SupabaseAuthGuard)
export class GoogleAdsController {
  constructor(
    private readonly googleAds: GoogleAdsService,
    private readonly webhookConfig: WebhookConfigService,
  ) {}

  /**
   * Lista unificada do seletor de cliente: contas da MCC do Google Ads +
   * clientes "só Meta" (sem conta no Google, ex: um produto próprio ou um
   * cliente cujo Google ainda não foi conectado). Cada entrada diz o que ela
   * tem (hasGoogle/hasMeta) — as abas Google/Meta usam isso pra saber se
   * mostram dado ou um estado vazio, sem tentar buscar o que não existe.
   */
  @Get('accounts')
  async listAccounts(@Req() req: any) {
    const [googleAccounts, metaClients] = await Promise.all([
      this.googleAds.listManagedAccounts(),
      this.webhookConfig.listMetaClients(),
    ]);
    const metaIds = new Set(metaClients.map((m) => m.customerId));

    const combined = [
      ...googleAccounts.map((a) => ({ ...a, hasGoogle: true, hasMeta: metaIds.has(a.id) })),
      ...metaClients
        .filter((m) => !googleAccounts.some((a) => a.id === m.customerId))
        .map((m) => ({ id: m.customerId, name: m.accountName ?? m.customerId, currency: null, hasGoogle: false, hasMeta: true })),
    ];

    const user = req.user as AuthUser | undefined;
    // Cliente enxerga somente a própria conta
    if (user && user.role !== 'admin') {
      return combined.filter((a) => a.id === user.customerId);
    }
    return combined;
  }

  @Get(':customerId/overview')
  getOverview(
    @Param('customerId') customerId: string,
    @Query('period') period = 'LAST_7_DAYS',
  ) {
    return this.googleAds.getAccountOverview(customerId, period);
  }

  @Get(':customerId/campaigns')
  listCampaigns(
    @Param('customerId') customerId: string,
    @Query('period') period = 'LAST_7_DAYS',
  ) {
    return this.googleAds.listCampaigns(customerId, period);
  }

  @Get(':customerId/campaigns/:campaignId')
  getCampaign(
    @Param('customerId') customerId: string,
    @Param('campaignId') campaignId: string,
    @Query('period') period = 'LAST_7_DAYS',
  ) {
    return this.googleAds.getCampaignDetails(customerId, campaignId, period);
  }

  @Get(':customerId/campaigns/:campaignId/ad-groups')
  listAdGroups(
    @Param('customerId') customerId: string,
    @Param('campaignId') campaignId: string,
    @Query('period') period = 'LAST_7_DAYS',
  ) {
    return this.googleAds.listAdGroups(customerId, campaignId, period);
  }

  @Get(':customerId/campaigns/:campaignId/ads')
  listAds(
    @Param('customerId') customerId: string,
    @Param('campaignId') campaignId: string,
    @Query('period') period = 'LAST_7_DAYS',
  ) {
    return this.googleAds.listAds(customerId, campaignId, period);
  }

  @Get(':customerId/keywords')
  getKeywords(
    @Param('customerId') customerId: string,
    @Query('campaignId') campaignId?: string,
    @Query('period') period = 'LAST_7_DAYS',
  ) {
    return this.googleAds.getKeywordPerformance(customerId, campaignId, period);
  }

  @Get(':customerId/campaigns/:campaignId/negatives')
  getNegatives(
    @Param('customerId') customerId: string,
    @Param('campaignId') campaignId: string,
  ) {
    return this.googleAds.getNegativeKeywords(customerId, campaignId);
  }

  @Delete(':customerId/negatives')
  removeNegatives(
    @Param('customerId') customerId: string,
    @Body() body: { items: { nivel: 'campanha' | 'grupo'; resource_name: string }[] },
  ) {
    return this.googleAds.removeNegativeKeywords(customerId, body.items);
  }

  @Post(':customerId/campaigns/:campaignId/negatives')
  addNegative(
    @Param('customerId') customerId: string,
    @Param('campaignId') campaignId: string,
    @Body() body: { keyword: string; matchType: 'EXACT' | 'PHRASE' | 'BROAD'; nivel: 'campanha' | 'grupo'; adGroupId?: string },
  ) {
    return this.googleAds.addNegativeKeyword(customerId, campaignId, body.keyword, body.matchType, body.nivel, body.adGroupId);
  }

  @Post(':customerId/ad-groups/:adGroupId/keywords')
  addKeyword(
    @Param('customerId') customerId: string,
    @Param('adGroupId') adGroupId: string,
    @Body() body: { keyword: string; matchType: 'EXACT' | 'PHRASE' | 'BROAD' },
  ) {
    return this.googleAds.addPositiveKeyword(customerId, adGroupId, body.keyword, body.matchType);
  }

  @Get(':customerId/campaigns/:campaignId/demographics')
  getDemographics(
    @Param('customerId') customerId: string,
    @Param('campaignId') campaignId: string,
    @Query('period') period = 'LAST_30_DAYS',
  ) {
    return this.googleAds.getDemographics(customerId, campaignId, period);
  }

  @Get(':customerId/campaigns/:campaignId/day-of-week')
  getDayOfWeek(
    @Param('customerId') customerId: string,
    @Param('campaignId') campaignId: string,
    @Query('period') period = 'LAST_30_DAYS',
  ) {
    return this.googleAds.getDayOfWeek(customerId, campaignId, period);
  }

  @Get(':customerId/campaigns/:campaignId/devices')
  getDevices(
    @Param('customerId') customerId: string,
    @Param('campaignId') campaignId: string,
    @Query('period') period = 'LAST_30_DAYS',
  ) {
    return this.googleAds.getDevices(customerId, campaignId, period);
  }
}
