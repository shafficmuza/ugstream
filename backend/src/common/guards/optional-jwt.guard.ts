import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Identifies the caller when it can, and lets the request through when it
 * cannot.
 *
 * The catalogue endpoints are public — the home page and browse have to work
 * for someone who has never signed in. But they now have to answer a question
 * that depends on who is asking: a tester sees the test catalogue, everyone
 * else sees the live one. This resolves the caller when a usable token is
 * present and leaves `req.auth` undefined otherwise, so an anonymous visitor
 * is treated exactly as a normal viewer.
 *
 * Never throws. A malformed, expired or revoked token is not an error here,
 * it just means "not identified" — making a bad token fail an otherwise public
 * page would be a worse outcome than showing it the public catalogue.
 */
@Injectable()
export class OptionalJwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header?.startsWith('Bearer ')) return true;

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; sid: string }>(
        header.slice('Bearer '.length),
        { secret: this.config.get('JWT_ACCESS_SECRET') },
      );
      const user = await this.prisma.user.findUnique({
        where: { id: BigInt(payload.sub) },
        select: { id: true, role: true, status: true, isTester: true },
      });
      // A banned account is simply not identified here; the guarded endpoints
      // it actually needs still refuse it.
      if (user && user.status !== 'banned') {
        req.auth = {
          userId: user.id,
          sessionId: payload.sid,
          role: user.role,
          isTester: user.isTester,
        };
      }
    } catch {
      // Not identified. The endpoint stays public.
    }
    return true;
  }
}
