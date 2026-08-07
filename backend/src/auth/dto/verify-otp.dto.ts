import { IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class VerifyOtpDto {
  /** See RequestOtpDto — normalised and validated by `toE164()` in the service. */
  @IsString()
  @MinLength(7)
  @MaxLength(24)
  phone: string;

  // Real OTPs and master codes are six digits; the admin-set development code
  // may be as short as four, and is entered in this same field.
  @IsString()
  @Length(4, 8)
  code: string;

  @IsOptional()
  @IsString()
  deviceLabel?: string;
}
