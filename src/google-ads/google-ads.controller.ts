import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
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
