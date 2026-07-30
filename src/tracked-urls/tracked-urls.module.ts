import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrackedUrl } from './tracked-url.entity';
import { TrackedUrlDailyMetric } from './tracked-url-daily-metric.entity';
import { TrackedUrlsService } from './tracked-urls.service';
import { TrackedUrlsController } from './tracked-urls.controller';
import { TrackedUrlsTrackController } from './tracked-urls-track.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TrackedUrl, TrackedUrlDailyMetric])],
  controllers: [TrackedUrlsController, TrackedUrlsTrackController],
  providers: [TrackedUrlsService],
})
export class TrackedUrlsModule {}
