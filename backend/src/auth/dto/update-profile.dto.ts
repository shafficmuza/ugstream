import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  // Name/username is mandatory (collected after authentication).
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName: string;

  // Email and address are optional.
  @IsOptional()
  @IsEmail()
  @MaxLength(120)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;
}
