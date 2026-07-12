import { Module } from '@nestjs/common';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { LeadWebhookController } from './lead-webhook.controller';
import { LeadsModule } from '../leads/leads.module';
import { WebhookConfigModule } from '../webhook-config/webhook-config.module';
import { CrmStagesModule } from '../crm-stages/crm-stages.module';

@Module({
  imports: [LeadsModule, WebhookConfigModule, CrmStagesModule],
  controllers: [WhatsAppController, LeadWebhookController],
  providers: [WhatsAppService],
})
export class WhatsAppModule {}
