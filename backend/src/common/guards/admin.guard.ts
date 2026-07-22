import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Runs after JwtAuthGuard. Looks the role up fresh from the DB rather than
 * trusting a claim baked into the (long-lived, 30-day-refreshable) token,
 * so revoking admin access takes effect immediately.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userId = req.auth?.userId;
    if (!userId) throw new ForbiddenException();

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.role !== 'admin') {
      throw new ForbiddenException('Admin access required.');
    }
    return true;
  }
}
