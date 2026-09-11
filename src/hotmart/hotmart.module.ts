import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HotmartClickRef } from './hotmart-click-ref.entity';
import { HotmartSale } from './hotmart-sale.entity';
import { HotmartService } from './hotmart.service';
import { HotmartController } from './hotmart.controller';
import { WebhookConfigModule } from '../webhook-config/webhook-config.module';
import { LeadsModule } from '../leads/leads.module';
import { CrmStagesModule } from '../crm-stages/crm-stages.module';

@Module({
  imports: [TypeOrmModule.forFeature([HotmartClickRef, HotmartSale]), WebhookConfigModule, LeadsModule, CrmStagesModule],
  providers: [HotmartService],
  controllers: [HotmartController],
})
export class HotmartModule {}
