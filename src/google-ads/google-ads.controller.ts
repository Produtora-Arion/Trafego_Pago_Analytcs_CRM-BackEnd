import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { GoogleAdsService } from './google-ads.service';
import { ApiKeyGuard } from '../auth/api-key.guard';

@Controller('ads')
@UseGuards(ApiKeyGuard)
export class GoogleAdsController {
  constructor(private readonly googleAds: GoogleAdsService) {}

  @Get('accounts')
  listAccounts() {
    return this.googleAds.listManagedAccounts();
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
