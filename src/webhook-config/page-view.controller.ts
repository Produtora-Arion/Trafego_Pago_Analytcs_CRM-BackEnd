import { Controller, Get, Options, Param, Res } from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { WebhookConfigService } from './webhook-config.service';

/**
 * Endpoint público chamado por um pixel/script na LP de cada cliente,
 * pra contar acessos. URL exclusiva por cliente: GET /webhook/view/{slug}
 * (mesmo slug já usado pelo webhook de leads).
 */
@Controller('webhook/view')
export class PageViewController {
  constructor(private readonly webhookConfig: WebhookConfigService) {}

  @SkipThrottle()
  @Options(':slug')
  preflight(@Res() res: Response) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send();
  }

  // Máx. 120 acessos por minuto por IP — bem mais generoso que o webhook de
  // leads, já que pageview é acionado a cada carregamento de página.
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @Get(':slug')
  async record(@Param('slug') slug: string, @Res() res: Response) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    await this.webhookConfig.recordPageView(slug);
    // Sempre 204, mesmo com slug inválido — não dá pra um script externo
    // saber se o slug existe ou não.
    return res.status(204).send();
  }
}
