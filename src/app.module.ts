import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { GoogleAdsModule } from './google-ads/google-ads.module';
import { MetaAdsModule } from './meta-ads/meta-ads.module';
import { McpModule } from './mcp/mcp.module';
import { LeadsModule } from './leads/leads.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { CrmStagesModule } from './crm-stages/crm-stages.module';
import { WebhookConfigModule } from './webhook-config/webhook-config.module';
import { LossReasonsModule } from './loss-reasons/loss-reasons.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health.controller';
import { Lead } from './leads/lead.entity';
import { CrmStage } from './crm-stages/crm-stage.entity';
import { WebhookToken } from './webhook-config/webhook-token.entity';
import { PageViewDaily } from './webhook-config/page-view-daily.entity';
import { LossReason } from './loss-reasons/loss-reason.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Rate limit global: 120 requisições por minuto por IP (protege contra
    // brute force, scraping e flood). Rotas específicas podem reforçar.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.get<string>('DATABASE_URL'),
        entities: [Lead, CrmStage, WebhookToken, PageViewDaily, LossReason],
        // Schema gerenciado via SQL direto no Supabase — não usar synchronize
        synchronize: false,
        ssl: { rejectUnauthorized: false },
      }),
    }),
    GoogleAdsModule,
    MetaAdsModule,
    McpModule,
    LeadsModule,
    WhatsAppModule,
    CrmStagesModule,
    WebhookConfigModule,
    LossReasonsModule,
    AuthModule,
  ],
  controllers: [HealthController],
  providers: [
    // Aplica o rate limit a todas as rotas HTTP
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
