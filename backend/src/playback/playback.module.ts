import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StreamLeaseService } from './stream-lease.service';
import { PlaybackController } from './playback.controller';

/**
 * Concurrent-stream limiting. Split out rather than folded into episodes so
 * the auth module can also read the session cap without depending on the
 * whole catalogue layer.
 */
@Module({
  imports: [PrismaModule],
  controllers: [PlaybackController],
  providers: [StreamLeaseService],
  exports: [StreamLeaseService],
})
export class PlaybackModule {}
