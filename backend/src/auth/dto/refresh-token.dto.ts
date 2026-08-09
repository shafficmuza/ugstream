import { IsOptional, IsString } from 'class-validator';

export class RefreshTokenDto {
  // Optional: browser clients may present no body at all and rely on the
  // httpOnly refresh cookie instead (see AuthController.refresh) — that copy
  // survives Safari purging script-writable storage after 7 days of not
  // visiting, which used to silently sign web users out.
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
