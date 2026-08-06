import { Controller, Delete, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthContext, CurrentUser } from '../common/decorators/current-user.decorator';
import { StreamLeaseService } from './stream-lease.service';

/**
 * Lets a client give back its concurrent-stream slot the moment playback
 * stops, instead of waiting out the staleness window. Purely an optimisation
 * — losing the call (a killed app, a lost network) is harmless because the
 * lease expires on its own.
 */
@UseGuards(JwtAuthGuard)
@Controller('playback')
export class PlaybackController {
  constructor(private readonly leases: StreamLeaseService) {}

  @Delete('stream')
  async stop(@CurrentUser() auth: AuthContext) {
    await this.leases.release(auth.sessionId);
    return { released: true };
  }

  /** What this account has playing right now, across devices. */
  @Get('streams')
  async active(@CurrentUser() auth: AuthContext) {
    const leases = await this.leases.activeFor(auth.userId);
    return leases.map((l) => ({
      episodeId: l.episodeId.toString(),
      deviceLabel: l.deviceLabel,
      startedAt: l.startedAt,
      // Lets the caller mark which row is the device asking.
      isCurrent: l.sessionId === auth.sessionId,
    }));
  }
}
