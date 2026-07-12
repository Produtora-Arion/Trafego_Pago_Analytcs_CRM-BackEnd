import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GoogleAdsModule } from './google-ads/google-ads.module';
import { MetaAdsModule } from './meta-ads/meta-ads.module';
import { McpModule } from './mcp/mcp.module';
import { LeadsModule } from './leads/leads.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { CrmStagesModule } from './crm-stages/crm-stages.module';
import { WebhookConfigModule } from './webhook-config/webhook-config.module';
import { Lead } from './leads/lead.entity';
import { CrmStage } from './crm-stages/crm-stage.entity';
import { WebhookToken } from './webhook-config/webhook-token.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: 'leads.db',
      entities: [Lead, CrmStage, WebhookToken],
      synchronize: true,
    }),
    GoogleAdsModule,
    MetaAdsModule,
    McpModule,
    LeadsModule,
    WhatsAppModule,
    CrmStagesModule,
    WebhookConfigModule,
  ],
})
export class AppModule {}
