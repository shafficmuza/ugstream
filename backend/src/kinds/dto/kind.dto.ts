import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateKindDto {
  @IsString() @MaxLength(50)
  name: string;

  @IsString() @MaxLength(60)
  slug: string;

  @IsOptional() @IsInt() @Min(0)
  sortOrder?: number;
}
