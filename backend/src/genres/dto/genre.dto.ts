import { IsString, MaxLength } from 'class-validator';

export class CreateGenreDto {
  @IsString() @MaxLength(50)
  name: string;

  @IsString() @MaxLength(60)
  slug: string;
}
