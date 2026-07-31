import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Records content actions (who uploaded/created what, when) for the admin
 * "Activity" audit view. Logging is best-effort — a failure here must never
 * break the actual upload, so writes are fire-and-forget.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(private readonly prisma: PrismaService) {}

  log(userId: bigint, action: string, summary: string, titleId?: bigint): void {
    this.prisma.activityLog
      .create({ data: { userId, action, summary: summary.slice(0, 300), titleId } })
      .catch((e) => this.logger.warn(`activity log failed: ${e?.message ?? e}`));
  }
}
