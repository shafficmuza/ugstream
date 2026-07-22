import { IsOptional, IsPhoneNumber, IsString, Length } from 'class-validator';

export class VerifyOtpDto {
  @IsPhoneNumber('UG')
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
