import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional() @IsIn(['user', 'editor', 'admin'])
  role?: 'user' | 'editor' | 'admin';

  @IsOptional() @IsIn(['active', 'banned'])
  status?: 'active' | 'banned';

  @IsOptional() @IsString() @MaxLength(100)
  displayName?: string;

  /** Put this account on the test catalogue instead of the live one. */
  @IsOptional() @IsBoolean()
  isTester?: boolean;

  /** Early access: see every title while the catalogue is held back. */
  @IsOptional() @IsBoolean()
  canPreviewAll?: boolean;
}
