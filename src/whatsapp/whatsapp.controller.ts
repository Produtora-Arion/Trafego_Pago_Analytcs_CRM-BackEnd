import { Controller, Get, Post, Body, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { WhatsAppService } from './whatsapp.service';

@Controller('webhook/whatsapp')
export class WhatsAppController {
  constructor(private readonly wa: WhatsAppService) {}

  // Meta chama este GET para verificar o webhook na configuração inicial
  @Get()
  verify(@Query() q: Record<string, string>, @Res() res: Response) {
    const mode = q['hub.mode'];
    const token = q['hub.verify_token'];
    const challenge = q['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log('[WhatsApp] Webhook verificado com sucesso');
      return res.status(200).send(challenge);
    }
    console.warn('[WhatsApp] Verificação falhou — token incorreto');
    return res.status(403).send('Forbidden');
  }

  // Meta envia aqui cada evento (mensagem recebida, status, etc.)
  @Post()
  async receive(@Body() body: any, @Res() res: Response) {
    // Responde 200 imediatamente — Meta re-tenta se demorar mais de 20s
    res.status(200).send('EVENT_RECEIVED');
    await this.wa.processWebhook(body).catch(err =>
      console.error('[WhatsApp] Erro ao processar webhook:', err),
    );
  }
}
