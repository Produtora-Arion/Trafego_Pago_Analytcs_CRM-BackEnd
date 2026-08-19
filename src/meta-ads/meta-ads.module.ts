import { Module } from '@nestjs/common';
import { MetaAdsService } from './meta-ads.service';
import { MetaAdsController } from './meta-ads.controller';
import { WebhookConfigModule } from '../webhook-config/webhook-config.module';

@Module({
  imports: [WebhookConfigModule],
  providers: [MetaAdsService],
  controllers: [MetaAdsController],
})
export class MetaAdsModule {}
