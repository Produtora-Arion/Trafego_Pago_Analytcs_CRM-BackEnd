import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';
import { MonthlyReport } from './monthly-report.entity';
import { ReportCampaignSelection } from './report-campaign-selection.entity';
import { GoogleAdsModule } from '../google-ads/google-ads.module';
import { MetaAdsModule } from '../meta-ads/meta-ads.module';
import { WebhookConfigModule } from '../webhook-config/webhook-config.module';
import { LeadsModule } from '../leads/leads.module';
import { CrmStagesModule } from '../crm-stages/crm-stages.module';
import { LossReasonsModule } from '../loss-reasons/loss-reasons.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([MonthlyReport, ReportCampaignSelection]),
    GoogleAdsModule,
    MetaAdsModule,
    WebhookConfigModule,
    LeadsModule,
    CrmStagesModule,
    LossReasonsModule,
  ],
  providers: [ReportsService],
  controllers: [ReportsController],
})
export class ReportsModule {}
