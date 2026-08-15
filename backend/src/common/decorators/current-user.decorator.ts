import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthContext {
  userId: bigint;
  sessionId: string;
  role: string;
  /** Sees the test catalogue instead of the live one. */
  isTester: boolean;
  /** Early access: sees every title, published or not. */
  canPreviewAll: boolean;
}

/** Pulls the auth context set by JwtAuthGuard onto req.auth. */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthContext => {
    const req = ctx.switchToHttp().getRequest();
    return req.auth;
  },
);
