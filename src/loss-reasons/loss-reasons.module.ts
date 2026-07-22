import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LossReason } from './loss-reason.entity';
import { LossReasonsService } from './loss-reasons.service';
import { LossReasonsController } from './loss-reasons.controller';
import { Lead } from '../leads/lead.entity';

@Module({
  imports: [TypeOrmModule.forFeature([LossReason, Lead])],
  controllers: [LossReasonsController],
  providers: [LossReasonsService],
  exports: [LossReasonsService],
})
export class LossReasonsModule {}
