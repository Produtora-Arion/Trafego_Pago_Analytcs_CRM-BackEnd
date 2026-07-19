import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from './lead.entity';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { GoogleAdsModule } from '../google-ads/google-ads.module';
import { CrmStagesModule } from '../crm-stages/crm-stages.module';

@Module({
  imports: [TypeOrmModule.forFeature([Lead]), GoogleAdsModule, CrmStagesModule],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
