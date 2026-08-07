import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * How often a session's lastSeenAt is written. Any device making authenticated
 * requests is in use; the interval only keeps that from costing a write per
 * request. Well under the access token's 15-minute life, so a session cannot
 * look stale while its holder is active.
 */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Sessions touched recently, so a busy client does not issue the UPDATE on
 * every call. Advisory only — the statement carries its own predicate, so
 * correctness never depends on this surviving a restart.
 */
const lastTouched = new Map<string, number>();
const TOUCH_CACHE_LIMIT = 5000;

/**
 * Verifies the bearer access token, then loads the user to (a) enforce
 * account status on EVERY authenticated request — a banned account is
 * refused immediately, not only at login/refresh — and (b) attach
 * { userId, sessionId, role } to `req.auth` so downstream guards and
 * handlers have the fresh role without re-querying.
 *
 * It also marks the session as seen. That matters because the device cap
 * evicts the least recently seen session: until this existed, lastSeenAt moved
 * only on token refresh, so a phone streaming a film — which talks to the API
 * the whole time via the playback heartbeat — still looked idle for the length
 * of the film and was the first thing evicted by any new sign-in. The user
 * came back to "invalid token" and a login screen at the end of a movie.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token.');
    }

    const token = header.slice('Bearer '.length);
    let payload: { sub: string; sid: string };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired access token.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: BigInt(payload.sub) },
      select: { id: true, role: true, status: true },
    });
    if (!user) throw new UnauthorizedException('Account no longer exists.');
    if (user.status === 'banned') throw new ForbiddenException('This account has been suspended.');

    req.auth = { userId: user.id, sessionId: payload.sid, role: user.role };
    this.touchSession(payload.sid);
    return true;
  }

  /**
   * Record that this session is alive. Deliberately not awaited: keeping a
   * session's place in the eviction order is not worth adding latency to every
   * authenticated request, and a lost write only means the next request does
   * it instead.
   */
  private touchSession(sessionId: string | undefined): void {
    if (!sessionId) return; // tokens minted before sid existed

    const now = Date.now();
    const seen = lastTouched.get(sessionId);
    if (seen !== undefined && now - seen < TOUCH_INTERVAL_MS) return;
    lastTouched.set(sessionId, now);

    // Bound the map on a long-running process; the predicate below means
    // dropping entries costs at most one redundant UPDATE each.
    if (lastTouched.size > TOUCH_CACHE_LIMIT) {
      for (const [id, at] of lastTouched) {
        if (now - at >= TOUCH_INTERVAL_MS) lastTouched.delete(id);
      }
    }

    // updateMany, not update: a revoked or already-deleted session must be a
    // no-op rather than a throw, and the lastSeenAt predicate keeps concurrent
    // requests from writing over each other.
    void this.prisma.session
      .updateMany({
        where: {
          id: sessionId,
          revokedAt: null,
          lastSeenAt: { lt: new Date(now - TOUCH_INTERVAL_MS) },
        },
        data: { lastSeenAt: new Date(now) },
      })
      .catch(() => undefined);
  }
}
