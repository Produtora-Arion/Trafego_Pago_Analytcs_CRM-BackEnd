import { Module } from '@nestjs/common';
import { GoogleAdsService } from './google-ads.service';
import { GoogleAdsController } from './google-ads.controller';

@Module({
  controllers: [GoogleAdsController],
  providers: [GoogleAdsService],
  exports: [GoogleAdsService],
})
export class GoogleAdsModule {}
