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
 * Verifies the bearer access token, then loads the user to (a) enforce
 * account status on EVERY authenticated request — a banned account is
 * refused immediately, not only at login/refresh — and (b) attach
 * { userId, sessionId, role } to `req.auth` so downstream guards and
 * handlers have the fresh role without re-querying.
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
    return true;
  }
}
