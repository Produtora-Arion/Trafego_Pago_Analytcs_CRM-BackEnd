import { Module } from '@nestjs/common';
import { McpService } from './mcp.service';
import { GoogleAdsModule } from '../google-ads/google-ads.module';

@Module({
  imports: [GoogleAdsModule],
  providers: [McpService],
})
export class McpModule {}
