import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Allows staff — role 'admin' OR 'editor' — through. Used on content-
 * management endpoints (add/edit titles, upload video, add genres/kinds,
 * publish). Delete and critical endpoints additionally stack AdminGuard, so
 * because Nest requires ALL guards to pass, those stay admin-only even on a
 * controller whose class-level guard is StaffGuard. Role is read fresh from
 * the DB (like AdminGuard) so a demotion takes effect immediately.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userId = req.auth?.userId;
    if (!userId) throw new ForbiddenException();

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || (user.role !== 'admin' && user.role !== 'editor')) {
      throw new ForbiddenException('Staff access required.');
    }
    return true;
  }
}
