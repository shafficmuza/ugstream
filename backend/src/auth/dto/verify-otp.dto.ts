import { IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class VerifyOtpDto {
  /** See RequestOtpDto — normalised and validated by `toE164()` in the service. */
  @IsString()
  @MinLength(7)
  @MaxLength(24)
  phone: string;

  @IsString()
  // 4 chars to allow the temporary OTP_STATIC_CODE bypass ("1234") — back
  // to @Length(6, 6) once a real SMS provider replaces it.
  @Length(4, 6)
  code: string;

  @IsOptional()
  @IsString()
  deviceLabel?: string;
}
