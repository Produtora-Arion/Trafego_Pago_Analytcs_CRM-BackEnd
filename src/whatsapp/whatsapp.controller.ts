import { Controller, Get, Post, Body, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { RawBodyRequest } from '@nestjs/common';
import { Request, Response } from 'express';
import { WhatsAppService } from './whatsapp.service';

@Controller('webhook/whatsapp')
export class WhatsAppController {
  constructor(
    private readonly wa: WhatsAppService,
    private readonly config: ConfigService,
  ) {}

  // Meta chama este GET para verificar o webhook na configuração inicial
  @Get()
  verify(@Query() q: Record<string, string>, @Res() res: Response) {
    const mode = q['hub.mode'];
    const token = q['hub.verify_token'];
    const challenge = q['hub.challenge'];

    if (mode === 'subscribe' && token === this.config.get('WHATSAPP_VERIFY_TOKEN')) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  /**
   * Valida a assinatura HMAC-SHA256 que a Meta envia no header
   * X-Hub-Signature-256, calculada sobre o corpo bruto com o APP_SECRET.
   * Sem isso, qualquer um poderia forjar eventos e injetar leads.
   */
  private isValidSignature(req: RawBodyRequest<Request>): boolean {
    const secret = this.config.get<string>('META_APP_SECRET');
    if (!secret) return false; // sem secret configurado, recusa tudo

    const header = req.headers['x-hub-signature-256'] as string | undefined;
    const raw = req.rawBody;
    if (!header || !raw) return false;

    const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(header);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  // Meta envia aqui cada evento (mensagem recebida, status, etc.)
  @Post()
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Body() body: any,
    @Res() res: Response,
  ) {
    if (!this.isValidSignature(req)) {
      return res.status(401).send('Invalid signature');
    }

    // Responde 200 imediatamente — Meta re-tenta se demorar mais de 20s
    res.status(200).send('EVENT_RECEIVED');
    await this.wa.processWebhook(body).catch(() => {
      // erro processado sem logar PII do corpo
    });
  }
}
