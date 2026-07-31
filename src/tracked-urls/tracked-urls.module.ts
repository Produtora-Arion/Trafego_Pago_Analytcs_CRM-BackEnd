import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrackedUrl } from './tracked-url.entity';
import { TrackedUrlDailyMetric } from './tracked-url-daily-metric.entity';
import { TrackedUrlVisitor } from './tracked-url-visitor.entity';
import { TrackedUrlFormSubmission } from './tracked-url-form-submission.entity';
import { TrackedUrlsService } from './tracked-urls.service';
import { TrackedUrlsController } from './tracked-urls.controller';
import { TrackedUrlsTrackController } from './tracked-urls-track.controller';

@Module({
  imports: [TypeOrmModule.forFeature([
    TrackedUrl, TrackedUrlDailyMetric, TrackedUrlVisitor, TrackedUrlFormSubmission,
  ])],
  controllers: [TrackedUrlsController, TrackedUrlsTrackController],
  providers: [TrackedUrlsService],
})
export class TrackedUrlsModule {}
