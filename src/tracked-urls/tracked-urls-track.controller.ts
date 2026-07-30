import { Controller, Get, Options, Param, Res } from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { TrackedUrlsService } from './tracked-urls.service';

/**
 * Endpoint público chamado por um pixel/script na página monitorada.
 * URL: GET /t/{slug}/access (carregamento de página) ou GET /t/{slug}/form (envio de formulário).
 */
@Controller('t')
export class TrackedUrlsTrackController {
  constructor(private readonly service: TrackedUrlsService) {}

  @SkipThrottle()
  @Options(':slug/:event')
  preflight(@Res() res: Response) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send();
  }

  // Máx. 120 hits por minuto por IP — cobre acesso (a cada pageload) e form.
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @Get(':slug/:event')
  async record(
    @Param('slug') slug: string,
    @Param('event') event: string,
    @Res() res: Response,
  ) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    if (event === 'access' || event === 'form') {
      await this.service.recordEvent(slug, event);
    }
    // Sempre 204 — não dá pra um script externo saber se o slug/evento é válido.
    return res.status(204).send();
  }
}
