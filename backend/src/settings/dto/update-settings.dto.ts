import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional() @IsIn(['momo', 'flutterwave', 'yo', 'dpo'])
  mobileMoneyProvider?: string;

  @IsOptional() @IsIn(['auto', 'africastalking', 'twilio'])
  smsProvider?: string;

  @IsOptional() @IsString() @MaxLength(80)
  appName?: string;

  @IsOptional() @IsString()
  logoUrl?: string;

  @IsOptional() @IsString() @MaxLength(160)
  tagline?: string;

  @IsOptional() @IsEmail()
  supportEmail?: string;

  @IsOptional() @IsString() @MaxLength(20)
  supportPhone?: string;

  @IsOptional() @IsString()
  heroBackgroundUrl?: string;

  @IsOptional() @IsString()
  authBackgroundUrl?: string;

  @IsOptional() @IsBoolean()
  pushEnabled?: boolean;

  @IsOptional() @IsIn(['all', 'subscribers'])
  pushAudience?: string;

  // Upper bounds are sanity rails, not policy: they stop a typo turning a
  // paid-tier limit into an effectively unlimited account. 0 means unlimited
  // and is handled explicitly by the enforcing code.
  @IsOptional() @IsInt() @Min(0) @Max(20)
  maxSessions?: number;

  @IsOptional() @IsInt() @Min(0) @Max(20)
  maxStreams?: number;

  // OTP caps, per phone number. Upper bounds are again sanity rails: the
  // ceilings are high enough for any legitimate policy and low enough that a
  // slipped digit can't turn into an open tap on the SMS bill. 0 disables the
  // individual check.
  @IsOptional() @IsInt() @Min(0) @Max(3600)
  otpCooldownSeconds?: number;

  @IsOptional() @IsInt() @Min(0) @Max(50)
  otpPerHour?: number;

  @IsOptional() @IsInt() @Min(0) @Max(200)
  otpPerDay?: number;
}
