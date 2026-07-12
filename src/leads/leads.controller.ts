import { Controller, Get, Patch, Post, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeadsService, CreateLeadDto } from './leads.service';
import { GoogleAdsService } from '../google-ads/google-ads.service';
import { ApiKeyGuard } from '../auth/api-key.guard';

@Controller('leads')
@UseGuards(ApiKeyGuard)
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly googleAds: GoogleAdsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  findAll(@Query('customerId') customerId?: string) {
    return this.leads.findAll(customerId);
  }

  @Post()
  create(@Body() body: CreateLeadDto) {
    return this.leads.upsertFromWebhook(body);
  }

  @Delete(':id')
  deleteById(@Param('id') id: string) {
    return this.leads.deleteById(Number(id));
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body('status') status: any) {
    return this.leads.updateStatus(Number(id), status);
  }

  @Post(':id/convert')
  async convert(
    @Param('id') id: string,
    @Body('value') value: number,
    @Body('customerId') customerIdBody: string,
    @Body('conversionActionId') conversionActionIdBody: string,
    @Body('status') statusBody?: string,
  ) {
    const customerId = customerIdBody || this.config.get('GA_CONVERSION_CUSTOMER_ID', '');
    const conversionActionId = conversionActionIdBody || this.config.get('GA_CONVERSION_ACTION_ID', '');

    const lead = await this.leads.markConverted(
      Number(id),
      value ?? 0,
      customerId,
      conversionActionId,
      statusBody,
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
