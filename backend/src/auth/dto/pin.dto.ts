import { IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

/** Phone-only body, for asking which sign-in step to show. */
export class SignInMethodDto {
  @IsString()
  @MinLength(7)
  @MaxLength(24)
  phone: string;
}

export class PinLoginDto {
  @IsString()
  @MinLength(7)
  @MaxLength(24)
  phone: string;

  @IsString()
  @Length(4, 8)
  pin: string;

  @IsOptional()
  @IsString()
  deviceLabel?: string;
}

export class SetPinDto {
  @IsString()
  @Length(4, 8)
  pin: string;

  /** Required only when replacing an existing PIN; enforced in PinService. */
  @IsOptional()
  @IsString()
  @Length(4, 8)
  currentPin?: string;
}
