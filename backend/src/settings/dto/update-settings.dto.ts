import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

// The support-contact fields are the only ones a client may clear. Omitting a
// field still means "leave it alone", so `null` is how the admin UI says "this
// channel is gone" — an empty string would be published as a blank contact row
// rather than hiding it. ValidateIf lets that null past the format checks
// without weakening them for a real value: an email that is present still has
// to look like an email.
const notNull = () => ValidateIf((_object: unknown, value: unknown) => value !== null);

export class UpdateSettingsDto {
  // The launch-day switch. 'test' serves the test catalogue to everyone,
  // anonymous visitors included; 'live' is the post-launch arrangement where
  // ordinary viewers see published titles. See titles/audience.ts.
  @IsOptional() @IsIn(['test', 'live'])
  catalogueMode?: string;

  @IsOptional() @IsIn(['momo', 'flutterwave', 'yo', 'dpo'])
  mobileMoneyProvider?: string;

  // Every mode the admin screen offers, and every mode SmsService honours.
  // Route Mobile and BulkSMS were missing here long after both shipped, so
  // choosing either in the UI was rejected by this validator — the setting
  // appeared in the list and could not be saved.
  @IsOptional()
  @IsIn(['auto', 'routemobile', 'bulksms', 'africastalking', 'twilio', 'twilioverify', 'custom'])
  smsProvider?: string;

  @IsOptional() @IsString() @MaxLength(80)
  appName?: string;

  @IsOptional() @IsString()
  logoUrl?: string;

  @IsOptional() @IsString() @MaxLength(160)
  tagline?: string;

  @IsOptional() @notNull() @IsEmail()
  supportEmail?: string | null;

  @IsOptional() @notNull() @IsString() @MaxLength(20)
  supportPhone?: string | null;

  // E.164, since the app builds a wa.me link out of it. 20 matches
  // supportPhone: 15 digits plus '+' is the longest legitimate number.
  @IsOptional() @notNull() @IsString() @MaxLength(20)
  supportWhatsapp?: string | null;

  // Free text ("Mon–Sat, 9am–8pm EAT"). Capped at a line's worth so it stays
  // a caption under the contact options rather than a paragraph.
  @IsOptional() @notNull() @IsString() @MaxLength(80)
  supportHours?: string | null;

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
