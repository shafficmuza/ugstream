import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class SaveProgressDto {
  @IsInt()
  @Min(0)
  positionSecs: number;
}

class EpisodeMetaDto {
  @IsOptional() @IsInt() @Min(0)
  season?: number;

  @IsOptional() @IsInt() @Min(0)
  number?: number;

  @IsOptional() @IsString() @MaxLength(200)
  name?: string;
}

export class CreateEpisodeDto extends EpisodeMetaDto {}

export class ImportUrlDto extends EpisodeMetaDto {
  @IsString()
  @MaxLength(2000)
  url: string;
}

export class RegisterR2FileDto extends EpisodeMetaDto {
  @IsString()
  @MaxLength(300)
  key: string;
}

export class RegisterR2HlsDto extends EpisodeMetaDto {
  @IsString()
  @MaxLength(300)
  prefix: string;
}

export class TranscodeUrlDto extends EpisodeMetaDto {
  @IsString()
  @MaxLength(2000)
  url: string;
}

export class TranscodeR2Dto extends EpisodeMetaDto {
  @IsString()
  @MaxLength(300)
  key: string;
}
