import { Controller, Post, Body, Param, Req, Res, Options, Logger } from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { LeadsService, CreateLeadDto } from '../leads/leads.service';
import { WebhookConfigService } from '../webhook-config/webhook-config.service';
import { CrmStagesService } from '../crm-stages/crm-stages.service';

/** Campos reconhecidos do payload — o restante vai para extraData */
const KNOWN_FIELDS = new Set([
  'phone', 'telefone', 'tel', 'whatsapp', 'celular',
  'email', 'e-mail', 'e_mail', 'mail', 'name', 'nome',
  'gclid', 'fbclid', 'firstMessage', 'mensagem', 'message',
  'utmSource', 'utm_source', 'utmMedium', 'utm_medium',
  'utmCampaign', 'utm_campaign', 'utmContent', 'utm_content',
  'utmTerm', 'utm_term', 'landingPage', 'landing_page', 'pageUrl', 'page_url',
  'referrer', 'referer', 'ip', 'userAgent', 'user_agent',
  'browserLanguage', 'browser_language', 'language',
  'sessionId', 'session_id',
  // Pergunta de múltipla escolha do formulário (nome varia por cliente)
  'formChoice', 'form_choice', 'escolha', 'opcao', 'interesse',
  'assunto', 'beneficio', 'servico', 'categoria',
]);

const pick = (body: Record<string, any>, ...keys: string[]): string | undefined => {
  for (const k of keys) {
    const v = body[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return undefined;
};

/**
 * Endpoint público chamado pelo formulário do site.
 * URL exclusiva por cliente: POST /webhook/lead/{slug}
 */
@Controller('webhook/lead')
export class LeadWebhookController {
  private readonly logger = new Logger('LeadWebhook');

  constructor(
    private readonly leads: LeadsService,
    private readonly webhookConfig: WebhookConfigService,
    private readonly crmStages: CrmStagesService,
  ) {}

  @SkipThrottle()
  @Options(':slug')
  preflight(@Res() res: Response) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).send();
  }

  // Máx. 20 envios por minuto por IP — barra flood de leads falsos e força bruta de slug
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post(':slug')
  async receive(
    @Param('slug') slug: string,
    @Body() body: Record<string, any>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    res.setHeader('Access-Control-Allow-Origin', '*');

    // 1. Autentica pela URL (slug exclusivo do cliente)
    const customerId = await this.webhookConfig.validateSlug(slug);
    if (!customerId) {
      this.logger.warn(`Webhook rejeitado — slug inválido: ${slug}`);
      return res.status(401).json({ success: false, error: 'URL de webhook inválida' });
    }

    // 2. Validação mínima: precisa de telefone ou e-mail
    const phone = pick(body, 'phone', 'telefone', 'tel', 'whatsapp', 'celular');
    const email = pick(body, 'email', 'e-mail', 'e_mail', 'mail');
    if (!phone && !email) {
      this.logger.warn(`Webhook ${slug}: payload sem telefone nem e-mail`);
      return res.status(400).json({
        success: false,
        error: 'Envie ao menos um campo de contato: phone ou email',
      });
    }

    // 3. Contexto técnico — usa o body se enviado, senão captura dos headers
    const forwarded = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim();
    const ip = pick(body, 'ip') || forwarded || req.socket?.remoteAddress || undefined;
    const userAgent = pick(body, 'userAgent', 'user_agent') || (req.headers['user-agent'] as string) || undefined;
    const browserLanguage =
      pick(body, 'browserLanguage', 'browser_language', 'language') ||
      (req.headers['accept-language'] as string)?.split(',')[0] || undefined;
    const referrer = pick(body, 'referrer', 'referer') || (req.headers['referer'] as string) || undefined;

    // 4. Campos personalizados extras → extraData (JSON)
    const extras: Record<string, any> = {};
    for (const [key, value] of Object.entries(body)) {
      if (!KNOWN_FIELDS.has(key) && value !== undefined && value !== null && value !== '') {
        extras[key] = value;
      }
    }

    // 5. Etapa de entrada — a marcada explicitamente como "recebe leads novos"
    // (ou a primeira por posição, se nenhuma foi marcada). Cria etapas padrão se não existir.
    let firstStageLabel = 'Novo';
    try {
      const entryStage = await this.crmStages.findEntryStage(customerId);
      if (entryStage) firstStageLabel = entryStage.label;
    } catch (err) {
      this.logger.error(`Webhook ${slug}: erro ao buscar etapa de entrada — usando "Novo"`, err?.stack);
    }

    const dto: CreateLeadDto = {
      customerId,
      status: firstStageLabel,
      phone,
      email,
      name: pick(body, 'name', 'nome'),
      gclid: pick(body, 'gclid'),
      fbclid: pick(body, 'fbclid'),
      firstMessage: pick(body, 'firstMessage', 'mensagem', 'message'),
      formChoice: pick(body, 'formChoice', 'form_choice', 'escolha', 'opcao', 'interesse', 'assunto', 'beneficio', 'servico', 'categoria'),
      utmSource: pick(body, 'utmSource', 'utm_source'),
      utmMedium: pick(body, 'utmMedium', 'utm_medium'),
      utmCampaign: pick(body, 'utmCampaign', 'utm_campaign'),
      utmContent: pick(body, 'utmContent', 'utm_content'),
      utmTerm: pick(body, 'utmTerm', 'utm_term'),
      landingPage: pick(body, 'landingPage', 'landing_page', 'pageUrl', 'page_url'),
      referrer,
      ip,
      userAgent,
      browserLanguage,
      sessionId: pick(body, 'sessionId', 'session_id'),
      extraData: Object.keys(extras).length > 0 ? JSON.stringify(extras) : undefined,
    };

    try {
      const lead = await this.leads.upsertFromWebhook(dto);
      this.logger.log(`Lead recebido via webhook ${slug} → #${lead.id} (${phone || email})`);
      return res.status(201).json({ success: true, id: lead.id });
    } catch (err) {
      this.logger.error(`Webhook ${slug}: erro ao salvar lead`, err?.stack);
      return res.status(500).json({ success: false, error: 'Erro interno ao salvar lead' });
    }
  }
}
