import { Body, Controller, Get, Options, Param, Post, Query, Res } from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { TrackedUrlsService } from './tracked-urls.service';

/**
 * Endpoints públicos chamados pelo snippet colado na página monitorada:
 *   GET  /t/{slug}/access?vid=...    → pageview (vid = id anônimo do visitante, opcional)
 *   GET  /t/{slug}/click?label=...   → clique num botão/CTA (label identifica qual botão)
 *   GET  /t/{slug}/view?label=...&vid=...  → botão apareceu na tela (impressão) — mesmo label/vid do clique
 *   POST /t/{slug}/form              → envio de formulário, body = dados do formulário
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
  async access(
    @Param('slug') slug: string,
    @Query('vid') vid: string | undefined,
    @Query('utm_source') utmSource: string | undefined,
    @Query('utm_medium') utmMedium: string | undefined,
    @Query('utm_campaign') utmCampaign: string | undefined,
    @Res() res: Response,
  ) {
    this.cors(res);
    await this.service.recordAccess(slug, vid, utmSource, utmMedium, utmCampaign);
    // Sempre 204 — não dá pra um script externo saber se o slug é válido.
    return res.status(204).send();
  }

  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @Get(':slug/click')
  async click(
    @Param('slug') slug: string,
    @Query('label') label: string | undefined,
    @Res() res: Response,
  ) {
    this.cors(res);
    await this.service.recordClick(slug, label);
    return res.status(204).send();
  }

  // Impressão do botão — pode disparar uma vez por botão visível na tela, então
  // usa o mesmo limite generoso do acesso.
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @Get(':slug/view')
  async view(
    @Param('slug') slug: string,
    @Query('label') label: string | undefined,
    @Query('vid') vid: string | undefined,
    @Res() res: Response,
  ) {
    this.cors(res);
    await this.service.recordView(slug, label, vid);
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
