import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookToken } from './webhook-token.entity';
import { PageViewDaily } from './page-view-daily.entity';
import { WebhookConfigService } from './webhook-config.service';
import { WebhookConfigController } from './webhook-config.controller';
import { PageViewController } from './page-view.controller';

@Module({
  imports: [TypeOrmModule.forFeature([WebhookToken, PageViewDaily])],
  controllers: [WebhookConfigController, PageViewController],
  providers: [WebhookConfigService],
  exports: [WebhookConfigService],
})
export class WebhookConfigModule {}
