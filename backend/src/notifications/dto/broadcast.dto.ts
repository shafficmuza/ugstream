import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class BroadcastDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title: string;

  @IsString()
  @MinLength(3)
  @MaxLength(400)
  body: string;

  /** Deep-link path opened when the notification is tapped. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  path?: string;
}
