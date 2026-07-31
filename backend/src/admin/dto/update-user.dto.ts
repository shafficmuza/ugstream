import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional() @IsIn(['user', 'editor', 'admin'])
  role?: 'user' | 'editor' | 'admin';

  @IsOptional() @IsIn(['active', 'banned'])
  status?: 'active' | 'banned';

  @IsOptional() @IsString() @MaxLength(100)
  displayName?: string;
}
