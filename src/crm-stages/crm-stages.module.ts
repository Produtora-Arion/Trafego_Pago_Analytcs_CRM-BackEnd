import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrmStage } from './crm-stage.entity';
import { CrmStagesService } from './crm-stages.service';
import { CrmStagesController } from './crm-stages.controller';
import { Lead } from '../leads/lead.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CrmStage, Lead])],
  controllers: [CrmStagesController],
  providers: [CrmStagesService],
  exports: [CrmStagesService],
})
export class CrmStagesModule {}
