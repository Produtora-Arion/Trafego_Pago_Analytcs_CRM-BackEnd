import { Controller, Get, Options, Param, Post, Body, Query, Req, Res } from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { TrackedUrlsService } from './tracked-urls.service';

/**
 * Endpoints públicos chamados pela página monitorada:
 *   GET  /t/{slug}/pixel.js          → script único que instala tudo sozinho (recomendado)
 *   GET  /t/{slug}/access?vid=...&utm_source=...&utm_medium=...&utm_campaign=...  → pageview
 *   GET  /t/{slug}/click?label=...&vid=...&pos=...&utm_source=...  → clique num botão/CTA
 *   GET  /t/{slug}/view?label=...&vid=...&pos=...&utm_source=...   → botão apareceu na tela (impressão)
 *   GET  /t/{slug}/scroll?depth=25&vid=...&utm_source=...  → rolou até X% da página (25/50/75/95)
 *   POST /t/{slug}/form              → envio de formulário, body = dados do formulário
 *
 * `pos` = posição do botão entre os elementos [data-track] da página (pro relatório listar
 * os botões na ordem em que aparecem no site). `utm_*` em click/view/scroll = mesma UTM do
 * acesso, capturada de novo no momento do evento — dá pra saber qual campanha/anúncio gerou
 * aquele clique, visualização ou rolagem específica, não só o acesso.
 */
@Controller('t')
export class TrackedUrlsTrackController {
  constructor(private readonly service: TrackedUrlsService) {}

  private cors(res: Response) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    // O helmet() global do main.ts manda "Cross-Origin-Resource-Policy: same-origin"
    // por padrão em toda resposta — isso faz o navegador BLOQUEAR o pixel/pings quando
    // o site que chama é de outro domínio (é sempre o caso aqui). Sobrescreve só nessas
    // rotas públicas, sem afetar a proteção padrão do resto da API.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }

  /**
   * Script único e auto-atualizável — o cliente cola UMA VEZ no site
   * (<script src=".../t/{slug}/pixel.js" async>) e nunca mais precisa mexer:
   * qualquer melhoria na lógica de rastreio (ex: captura de UTM) passa a valer
   * sozinha na próxima visita, sem precisar copiar/colar código de novo.
   *
   * Cobre sozinho: acesso (com UTM e único) + clique/visualização de qualquer
   * elemento marcado com `data-track="nome-do-botao"` no HTML — delegação de
   * evento pra clique (funciona mesmo em botões renderizados depois pelo
   * React) e IntersectionObserver + MutationObserver pra visualização — e
   * profundidade de rolagem (25/50/75/95%) da página inteira, sem precisar
   * marcar nada no HTML.
   */
  @SkipThrottle()
  @Get(':slug/pixel.js')
  pixelScript(@Param('slug') slug: string, @Req() req: Request, @Res() res: Response) {
    const base = `${req.protocol}://${req.get('host')}`;
    const safeSlug = JSON.stringify(slug);
    const script = `(function () {
  var BASE = ${JSON.stringify(base)};
  var SLUG = ${safeSlug};
  var VID_KEY = 'arion_vid';

  function getVisitorId() {
    try {
      var vid = localStorage.getItem(VID_KEY);
      if (!vid) {
        vid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(36).slice(2));
        localStorage.setItem(VID_KEY, vid);
      }
      return vid;
    } catch (e) { return 'sem-id'; }
  }

  function ping(path, params) {
    var q = new URLSearchParams(params || {});
    fetch(BASE + '/t/' + SLUG + '/' + path + '?' + q.toString(), { keepalive: true }).catch(function () {});
  }

  // UTM atual da URL — usada no acesso E em clique/visualização, pra saber
  // exatamente qual campanha/anúncio gerou aquele clique ou aquela visualização.
  function getUtms() {
    var url = new URLSearchParams(window.location.search);
    var out = {};
    ['utm_source', 'utm_medium', 'utm_campaign'].forEach(function (k) {
      var v = url.get(k);
      if (v) out[k] = v;
    });
    return out;
  }

  // Posição do elemento entre os [data-track] da página — só pra listar os
  // botões no relatório na mesma ordem em que aparecem no site.
  function elPos(el) {
    var all = document.querySelectorAll('[data-track]');
    var idx = Array.prototype.indexOf.call(all, el);
    return idx >= 0 ? idx : undefined;
  }

  function trackAccess() {
    var params = Object.assign({ vid: getVisitorId() }, getUtms());
    ping('access', params);
  }

  function trackClick(label, el) {
    var params = Object.assign({ label: label, vid: getVisitorId() }, getUtms());
    var pos = el ? elPos(el) : undefined;
    if (pos !== undefined) params.pos = pos;
    ping('click', params);
  }

  function trackView(label, el) {
    var params = Object.assign({ label: label, vid: getVisitorId() }, getUtms());
    var pos = el ? elPos(el) : undefined;
    if (pos !== undefined) params.pos = pos;
    ping('view', params);
  }

  function trackScroll(depth) {
    var params = Object.assign({ depth: depth, vid: getVisitorId() }, getUtms());
    ping('scroll', params);
  }

  // Profundidade de rolagem — dispara uma vez por marco (25/50/75/95%), na
  // primeira vez que a pessoa passa dele. Quem chega em 95% também disparou os
  // marcos anteriores, então dá pra montar um funil "chegou até onde".
  var SCROLL_MILESTONES = [25, 50, 75, 95];
  var scrollSeen = {};
  function scrollPct() {
    var doc = document.documentElement, body = document.body || {};
    var top = window.scrollY || doc.scrollTop || body.scrollTop || 0;
    var scrollable = Math.max(doc.scrollHeight || 0, body.scrollHeight || 0) - window.innerHeight;
    if (scrollable <= 0) return 100; // página cabe inteira na tela — já "viu tudo"
    return Math.min(100, Math.round((top / scrollable) * 100));
  }
  var scrollTicking = false;
  function onScroll() {
    if (scrollTicking) return;
    scrollTicking = true;
    (window.requestAnimationFrame || function (fn) { setTimeout(fn, 100); })(function () {
      scrollTicking = false;
      var pct = scrollPct();
      SCROLL_MILESTONES.forEach(function (m) {
        if (pct >= m && !scrollSeen[m]) { scrollSeen[m] = true; trackScroll(m); }
      });
    });
  }

  // Clique automático em qualquer elemento com data-track — delegação no
  // document, então funciona mesmo em botões que o React ainda vai renderizar.
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-track]') : null;
    if (el) trackClick(el.getAttribute('data-track'), el);
  }, true);

  // Visualização automática — observa elementos com data-track, conta só na
  // primeira vez que cada um entra na tela.
  var seen = {};
  var io = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var label = entry.target.getAttribute('data-track');
      if (label && !seen[label]) {
        seen[label] = true;
        trackView(label, entry.target);
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.5 }) : null;

  function scan() {
    if (!io) return;
    document.querySelectorAll('[data-track]').forEach(function (el) { io.observe(el); });
  }

  function start() {
    trackAccess();
    scan();
    onScroll(); // cobre página curta (sem scroll) que já nasce "vista até o fim"
    window.addEventListener('scroll', onScroll, { passive: true });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
  // Sites em React/Next.js podem renderizar os botões um instante depois —
  // observa o DOM pra pegar quem apareceu depois do primeiro scan.
  if ('MutationObserver' in window) {
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  }

  // Pra quem quiser chamar na mão também (ex: onClick customizado).
  window.arionTrack = { click: trackClick, view: trackView };
})();
`;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    // Sem isso o navegador BLOQUEIA a própria tag <script src> quando o site que
    // carrega é de outro domínio (sempre é) — ver comentário em cors() acima.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    // Cache curto — atualizações no script (ex: melhorias de rastreio) chegam
    // aos sites em poucos minutos, sem o cliente precisar fazer nada.
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).send(script);
  }

  @SkipThrottle()
  @Options(':slug/:event')
  preflight(@Res() res: Response) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
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
    @Query('vid') vid: string | undefined,
    @Query('pos') pos: string | undefined,
    @Query('utm_source') utmSource: string | undefined,
    @Query('utm_medium') utmMedium: string | undefined,
    @Query('utm_campaign') utmCampaign: string | undefined,
    @Res() res: Response,
  ) {
    this.cors(res);
    await this.service.recordClick(slug, label, vid, pos, utmSource, utmMedium, utmCampaign);
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
    @Query('pos') pos: string | undefined,
    @Query('utm_source') utmSource: string | undefined,
    @Query('utm_medium') utmMedium: string | undefined,
    @Query('utm_campaign') utmCampaign: string | undefined,
    @Res() res: Response,
  ) {
    this.cors(res);
    await this.service.recordView(slug, label, vid, pos, utmSource, utmMedium, utmCampaign);
    return res.status(204).send();
  }

  // Rolagem — no máximo 4 marcos por pageload (25/50/75/95), mesmo limite do resto.
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @Get(':slug/scroll')
  async scroll(
    @Param('slug') slug: string,
    @Query('depth') depth: string | undefined,
    @Query('vid') vid: string | undefined,
    @Query('utm_source') utmSource: string | undefined,
    @Query('utm_medium') utmMedium: string | undefined,
    @Query('utm_campaign') utmCampaign: string | undefined,
    @Res() res: Response,
  ) {
    this.cors(res);
    await this.service.recordScroll(slug, Number(depth), vid, utmSource, utmMedium, utmCampaign);
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
