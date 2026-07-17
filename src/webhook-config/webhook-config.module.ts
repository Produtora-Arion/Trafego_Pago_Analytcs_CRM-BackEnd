import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WebhookToken } from './webhook-token.entity';
import { WebhookConfigService } from './webhook-config.service';
import { WebhookConfigController } from './webhook-config.controller';

@Module({
  imports: [TypeOrmModule.forFeature([WebhookToken])],
  controllers: [WebhookConfigController],
  providers: [WebhookConfigService],
  exports: [WebhookConfigService],
})
export class WebhookConfigModule {}
