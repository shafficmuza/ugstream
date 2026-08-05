import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDeviceDto {
  // FCM tokens are long opaque strings; bound them so a malformed client
  // cannot push arbitrarily large values into the table.
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  token: string;

  @IsIn(['android', 'ios', 'web'])
  platform: 'android' | 'ios' | 'web';

  @IsOptional()
  @IsString()
  @MaxLength(20)
  appVersion?: string;
}
