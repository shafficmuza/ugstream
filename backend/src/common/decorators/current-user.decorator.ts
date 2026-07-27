import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthContext {
  userId: bigint;
  sessionId: string;
  role: string;
}

/** Pulls the { userId, sessionId, role } set by JwtAuthGuard onto req.auth. */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthContext => {
    const req = ctx.switchToHttp().getRequest();
    return req.auth;
  },
);
