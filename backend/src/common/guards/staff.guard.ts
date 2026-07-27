import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Allows staff — role 'admin' OR 'editor' — through. Used on content-
 * management endpoints (add/edit titles, upload video, add genres/kinds,
 * publish). Delete and critical endpoints additionally stack AdminGuard, so
 * because Nest requires ALL guards to pass, those stay admin-only even on a
 * controller whose class-level guard is StaffGuard. Reads the fresh role
 * JwtAuthGuard loaded onto req.auth (it always runs first), so a demotion
 * takes effect immediately with no extra query.
 */
@Injectable()
export class StaffGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const role = req.auth?.role;
    if (role !== 'admin' && role !== 'editor') {
      throw new ForbiddenException('Staff access required.');
    }
    return true;
  }
}
