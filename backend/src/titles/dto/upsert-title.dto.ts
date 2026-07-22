import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpsertTitleDto {
  @IsIn(['movie', 'series'])
  kind: 'movie' | 'series';

  @IsString()
  name: string;

  @IsString()
  slug: string;

  @IsOptional() @IsString()
  description?: string;

  @IsOptional() @IsString()
  language?: string;

  @IsOptional() @IsString()
  vjName?: string;

  @IsOptional() @IsInt()
  releaseYear?: number;

  @IsOptional() @IsString()
  posterUrl?: string;

  @IsOptional() @IsString()
  bannerUrl?: string;

  @IsIn(['free', 'subscription', 'purchase', 'sub_or_purchase'])
  access: 'free' | 'subscription' | 'purchase' | 'sub_or_purchase';

  @IsOptional() @IsInt() @Min(0)
  priceUgx?: number;

  @IsOptional() @IsInt() @Min(1)
  rentalHours?: number;

  @IsOptional() @IsBoolean()
  published?: boolean;

  @IsOptional() @IsArray()
  genreIds?: number[];
}
