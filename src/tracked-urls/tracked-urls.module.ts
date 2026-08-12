import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrackedUrl } from './tracked-url.entity';
import { TrackedUrlAccessEvent } from './tracked-url-access-event.entity';
import { TrackedUrlButtonEvent } from './tracked-url-button-event.entity';
import { TrackedUrlFormSubmission } from './tracked-url-form-submission.entity';
import { TrackedUrlsService } from './tracked-urls.service';
import { TrackedUrlsController } from './tracked-urls.controller';
import { TrackedUrlsTrackController } from './tracked-urls-track.controller';

@Module({
  imports: [TypeOrmModule.forFeature([
    TrackedUrl, TrackedUrlAccessEvent, TrackedUrlButtonEvent, TrackedUrlFormSubmission,
  ])],
  controllers: [TrackedUrlsController, TrackedUrlsTrackController],
  providers: [TrackedUrlsService],
})
export class TrackedUrlsModule {}
