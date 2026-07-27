import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Admin-only. Reads the fresh role JwtAuthGuard already loaded onto
 * req.auth (JwtAuthGuard always runs first wherever this is used), so no
 * extra DB round trip. Revoking admin takes effect immediately because
 * JwtAuthGuard re-reads the role from the DB on every request.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (req.auth?.role !== 'admin') {
      throw new ForbiddenException('Admin access required.');
    }
    return true;
  }
}
