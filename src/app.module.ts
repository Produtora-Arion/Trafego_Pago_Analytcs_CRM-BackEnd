import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GoogleAdsModule } from './google-ads/google-ads.module';
import { McpModule } from './mcp/mcp.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    GoogleAdsModule,
    McpModule,
  ],
})
export class AppModule {}
