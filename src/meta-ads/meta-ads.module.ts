import { Module } from '@nestjs/common';
import { MetaAdsService } from './meta-ads.service';
import { MetaAdsController } from './meta-ads.controller';

@Module({
  providers: [MetaAdsService],
  controllers: [MetaAdsController],
})
export class MetaAdsModule {}
