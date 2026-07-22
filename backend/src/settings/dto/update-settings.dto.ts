import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSettingsDto {
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
}
