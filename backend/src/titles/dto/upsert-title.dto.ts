import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpsertTitleDto {
  // Free-form kind slug validated against the runtime-managed `kinds` table
  // (the admin UI only offers existing kinds). Kept as a String so new kinds
  // don't require a code change.
  @IsString()
  kind: string;

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
