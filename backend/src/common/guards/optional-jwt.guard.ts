import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { readAudienceCookie } from '../../auth/auth.controller';

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
 *
 * Also resolves `req.audience`, which is what the catalogue endpoints read.
 * An identified account always decides its own audience. Only when there is
 * no account to ask does the display-only cookie get a say — which is the
 * case for every server-rendered web page, where the browser's token is not
 * available while Next builds the HTML. Without that fallback a tester
 * browsing the website was served the live catalogue no matter what the
 * admin had toggled.
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
    if (!header?.startsWith('Bearer ')) {
      req.audience = readAudienceCookie(req.headers?.cookie);
      return true;
    }

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; sid: string }>(
        header.slice('Bearer '.length),
        { secret: this.config.get('JWT_ACCESS_SECRET') },
      );
      const user = await this.prisma.user.findUnique({
        where: { id: BigInt(payload.sub) },
        select: { id: true, role: true, status: true, isTester: true, canPreviewAll: true },
      });
      // A banned account is simply not identified here; the guarded endpoints
      // it actually needs still refuse it.
      if (user && user.status !== 'banned') {
        req.auth = {
          userId: user.id,
          sessionId: payload.sid,
          role: user.role,
          isTester: user.isTester,
          canPreviewAll: user.canPreviewAll,
        };
      }
    } catch {
      // Not identified. The endpoint stays public.
    }

    // The account's own flags win whenever we have them; the cookie only
    // answers for a request that arrived without a usable token.
    req.audience = req.auth ?? readAudienceCookie(req.headers?.cookie);
    return true;
  }
}
