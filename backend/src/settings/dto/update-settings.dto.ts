import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional() @IsIn(['momo', 'flutterwave', 'yo', 'dpo'])
  mobileMoneyProvider?: string;

  @IsOptional() @IsIn(['africastalking', 'twilio'])
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
}
