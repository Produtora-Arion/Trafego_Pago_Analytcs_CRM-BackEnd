import { Controller, Get, Post, Param, Query, Body, UseGuards } from '@nestjs/common';
import { WebhookConfigService } from './webhook-config.service';
import { ApiKeyGuard } from '../auth/api-key.guard';

@Controller('webhook-config')
@UseGuards(ApiKeyGuard)
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
}
