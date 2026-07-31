import { IsBoolean } from 'class-validator';

export class PublishTitleDto {
  @IsBoolean()
  published: boolean;
}
