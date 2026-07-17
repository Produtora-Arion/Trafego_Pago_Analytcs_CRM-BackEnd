import { Injectable } from '@nestjs/common';
import { LeadsService } from '../leads/leads.service';

@Injectable()
export class WhatsAppService {
  constructor(private readonly leads: LeadsService) {}

  async processWebhook(body: any): Promise<void> {
    const entry = body?.entry ?? [];

    for (const e of entry) {
      const changes = e?.changes ?? [];
      for (const change of changes) {
        const messages = change?.value?.messages ?? [];
        for (const msg of messages) {
          await this.handleMessage(msg);
        }
      }
    }
  }

  private async handleMessage(msg: any): Promise<void> {
    if (msg.type !== 'text') return;

    const phone = String(msg.from);           // ex: "5511999999999"
    const text  = String(msg.text?.body ?? '');

    // Extrai o GCLID embutido na mensagem pelo script da landing page
    // Formato esperado: "... Ref: Cj0KCAjw..."
    const gclidMatch = text.match(/Ref:\s*([A-Za-z0-9_\-]{20,})/);
    const gclid = gclidMatch?.[1] ?? null;

    const lead = await this.leads.upsertFromWhatsApp(phone, gclid, text);

    console.log(
      `[WhatsApp] Mensagem de ${phone} | GCLID: ${gclid ?? 'não rastreado'} | Lead ID: ${lead.id} | Status: ${lead.status}`,
    );
  }
}
