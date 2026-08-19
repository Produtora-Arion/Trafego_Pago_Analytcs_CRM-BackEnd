import { Controller, Get, Post, Patch, Param, Query, Body, UseGuards } from '@nestjs/common';
import { WebhookConfigService } from './webhook-config.service';
import { SupabaseAuthGuard, AdminOnlyGuard } from '../auth/supabase-auth.guard';

/**
 * Configuração de webhook e conversão é 100% administrativa — o cliente nunca
 * vê nem edita isso, pra evitar configuração errada (URL/token do webhook,
 * conversion action ID do Google Ads). Só quem tem role 'admin' acessa.
 */
@Controller('webhook-config')
@UseGuards(SupabaseAuthGuard, AdminOnlyGuard)
export class WebhookConfigController {
  constructor(private readonly service: WebhookConfigService) {}

  /** Retorna (ou cria) o webhook config do cliente. Passa ?name= para gerar slug. */
  @Get(':customerId')
  getOrCreate(
    @Param('customerId') customerId: string,
    @Query('name') name?: string,
  ) {
    return this.service.getOrCreate(customerId, name);
  }

  /** Gera novo slug e token — invalida imediatamente o anterior. */
  @Post(':customerId/regenerate')
  regenerate(
    @Param('customerId') customerId: string,
    @Body('name') name?: string,
  ) {
    return this.service.regenerate(customerId, name);
  }

  /** Define o conversion action ID do Google Ads usado nas conversões offline deste cliente. */
  @Patch(':customerId/conversion-action')
  updateConversionAction(
    @Param('customerId') customerId: string,
    @Body('conversionActionId') conversionActionId: string,
  ) {
    return this.service.updateConversionActionId(customerId, conversionActionId);
  }

  /** Token do Meta (Graph API) e conta de anúncio padrão desta conta — nunca compartilhado entre clientes. */
  @Patch(':customerId/meta')
  updateMetaConfig(
    @Param('customerId') customerId: string,
    @Body('metaAccessToken') metaAccessToken: string | undefined,
    @Body('metaAdAccountId') metaAdAccountId: string | undefined,
  ) {
    return this.service.updateMetaConfig(customerId, { accessToken: metaAccessToken, adAccountId: metaAdAccountId });
  }

  /** Acessos da LP por dia, no período informado (ou todo o histórico se omitido). */
  @Get(':customerId/pageviews')
  getPageViews(
    @Param('customerId') customerId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getPageViewStats(customerId, from, to);
  }
}
