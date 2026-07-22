import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthContext {
  userId: bigint;
  sessionId: string;
}

/** Pulls the { userId, sessionId } set by JwtAuthGuard onto req.auth. */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthContext => {
    const req = ctx.switchToHttp().getRequest();
    return req.auth;
  },
);
