import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SetFirebaseCredentialDto {
  /**
   * The full service-account JSON, pasted as-is. Optional/empty clears it,
   * which is how push gets switched off without deleting anything else.
   */
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  serviceAccount?: string;
}
