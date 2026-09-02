import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HotmartClickRef } from './hotmart-click-ref.entity';
import { HotmartSale } from './hotmart-sale.entity';
import { HotmartService } from './hotmart.service';
import { HotmartController } from './hotmart.controller';
import { WebhookConfigModule } from '../webhook-config/webhook-config.module';

@Module({
  imports: [TypeOrmModule.forFeature([HotmartClickRef, HotmartSale]), WebhookConfigModule],
  providers: [HotmartService],
  controllers: [HotmartController],
})
export class HotmartModule {}
