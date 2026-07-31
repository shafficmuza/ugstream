import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreatePlanDto {
  @IsString() @MaxLength(50)
  name: string;

  @IsInt() @Min(0)
  priceUgx: number;

  @IsInt() @Min(1)
  durationDays: number;
}

export class UpdatePlanDto {
  @IsOptional() @IsString() @MaxLength(50)
  name?: string;

  @IsOptional() @IsInt() @Min(0)
  priceUgx?: number;

  @IsOptional() @IsInt() @Min(1)
  durationDays?: number;

  @IsOptional() @IsBoolean()
  active?: boolean;
}
