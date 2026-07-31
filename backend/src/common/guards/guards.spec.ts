import { ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { StaffGuard } from './staff.guard';

function ctxWithRole(role?: string): any {
  return {
    switchToHttp: () => ({ getRequest: () => ({ auth: role ? { role } : undefined }) }),
  };
}

describe('AdminGuard', () => {
  const g = new AdminGuard();
  it('allows admin', () => expect(g.canActivate(ctxWithRole('admin'))).toBe(true));
  it('blocks editor', () => expect(() => g.canActivate(ctxWithRole('editor'))).toThrow(ForbiddenException));
  it('blocks user', () => expect(() => g.canActivate(ctxWithRole('user'))).toThrow(ForbiddenException));
  it('blocks missing auth', () => expect(() => g.canActivate(ctxWithRole())).toThrow(ForbiddenException));
});

describe('StaffGuard', () => {
  const g = new StaffGuard();
  it('allows admin', () => expect(g.canActivate(ctxWithRole('admin'))).toBe(true));
  it('allows editor', () => expect(g.canActivate(ctxWithRole('editor'))).toBe(true));
  it('blocks user', () => expect(() => g.canActivate(ctxWithRole('user'))).toThrow(ForbiddenException));
  it('blocks missing auth', () => expect(() => g.canActivate(ctxWithRole())).toThrow(ForbiddenException));
});
