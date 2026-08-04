import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrackedUrl } from './tracked-url.entity';
import { TrackedUrlDailyMetric } from './tracked-url-daily-metric.entity';
import { TrackedUrlAccessEvent } from './tracked-url-access-event.entity';
import { TrackedUrlFormSubmission } from './tracked-url-form-submission.entity';
import { TrackedUrlsService } from './tracked-urls.service';
import { TrackedUrlsController } from './tracked-urls.controller';
import { TrackedUrlsTrackController } from './tracked-urls-track.controller';

@Module({
  imports: [TypeOrmModule.forFeature([
    TrackedUrl, TrackedUrlDailyMetric, TrackedUrlAccessEvent, TrackedUrlFormSubmission,
  ])],
  controllers: [TrackedUrlsController, TrackedUrlsTrackController],
  providers: [TrackedUrlsService],
})
export class TrackedUrlsModule {}
