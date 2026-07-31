import { Body, Controller, Get, Options, Param, Post, Query, Res } from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { TrackedUrlsService } from './tracked-urls.service';

/**
 * Endpoints públicos chamados pelo snippet colado na página monitorada:
 *   GET  /t/{slug}/access?vid=...   → pageview (vid = id anônimo do visitante, opcional)
 *   GET  /t/{slug}/click            → clique num botão/CTA
 *   POST /t/{slug}/form             → envio de formulário, body = dados do formulário
 */
@Controller('t')
export class TrackedUrlsTrackController {
  constructor(private readonly service: TrackedUrlsService) {}

  private cors(res: Response) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
  }

  @SkipThrottle()
  @Options(':slug/:event')
  preflight(@Res() res: Response) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send();
  }

  // Máx. 120 hits por minuto por IP — cobre acesso (a cada pageload) e clique.
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @Get(':slug/access')
  async access(@Param('slug') slug: string, @Query('vid') vid: string | undefined, @Res() res: Response) {
    this.cors(res);
    await this.service.recordAccess(slug, vid);
    // Sempre 204 — não dá pra um script externo saber se o slug é válido.
    return res.status(204).send();
  }

  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @Get(':slug/click')
  async click(@Param('slug') slug: string, @Res() res: Response) {
    this.cors(res);
    await this.service.recordClick(slug);
    return res.status(204).send();
  }

  // Formulário: limite mais apertado, é uma ação intencional (não dispara a cada pageload).
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post(':slug/form')
  async form(@Param('slug') slug: string, @Body() body: Record<string, any>, @Res() res: Response) {
    this.cors(res);
    await this.service.recordForm(slug, body);
    return res.status(204).send();
  }
}
