import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { MetaAdsService } from './meta-ads.service';
import { ApiKeyGuard } from '../auth/api-key.guard';

@Controller('meta')
@UseGuards(ApiKeyGuard)
export class MetaAdsController {
  constructor(private readonly meta: MetaAdsService) {}

  @Get('accounts')
  listAccounts() {
    return this.meta.listAdAccounts();
  }

  @Get(':accountId/overview')
  getOverview(
    @Param('accountId') accountId: string,
    @Query('period') period = 'LAST_7_DAYS',
  ) {
    return this.meta.getAccountOverview(accountId, period);
  }

  @Get(':accountId/campaigns')
  listCampaigns(
    @Param('accountId') accountId: string,
    @Query('period') period = 'LAST_7_DAYS',
  ) {
    return this.meta.listCampaigns(accountId, period);
  }

  @Get(':accountId/campaigns/:campaignId/adsets')
  listAdSets(
    @Param('accountId') accountId: string,
    @Param('campaignId') campaignId: string,
    @Query('period') period = 'LAST_7_DAYS',
  ) {
    return this.meta.listAdSets(accountId, campaignId, period);
  }

  @Get(':accountId/campaigns/:campaignId/demographics')
  getDemographics(
    @Param('accountId') accountId: string,
    @Param('campaignId') campaignId: string,
    @Query('period') period = 'LAST_30_DAYS',
  ) {
    return this.meta.getDemographics(accountId, campaignId, period);
  }

  @Get(':accountId/campaigns/:campaignId/day-of-week')
  getDayOfWeek(
    @Param('accountId') accountId: string,
    @Param('campaignId') campaignId: string,
    @Query('period') period = 'LAST_30_DAYS',
  ) {
    return this.meta.getDayOfWeek(accountId, campaignId, period);
  }

  @Get(':accountId/campaigns/:campaignId/devices')
  getDevices(
    @Param('accountId') accountId: string,
    @Param('campaignId') campaignId: string,
    @Query('period') period = 'LAST_30_DAYS',
  ) {
    return this.meta.getDevices(accountId, campaignId, period);
  }

  @Get(':accountId/campaigns/:campaignId/placements')
  getPlacements(
    @Param('accountId') accountId: string,
    @Param('campaignId') campaignId: string,
    @Query('period') period = 'LAST_30_DAYS',
  ) {
    return this.meta.getPlacements(accountId, campaignId, period);
  }
}
