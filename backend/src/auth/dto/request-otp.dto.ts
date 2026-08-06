import { IsString, MaxLength, MinLength } from 'class-validator';

export class RequestOtpDto {
  /**
   * Deliberately loose. `@IsPhoneNumber('UG')` rejected every non-Ugandan
   * number, which locked the diaspora — the subscribers most able to pay
   * monthly — out of signup entirely.
   *
   * Real validation is `toE164()` in the service, which parses against the
   * full international numbering plan, defaults bare local numbers to Uganda
   * and rejects anything undialable. Keeping it there rather than in the DTO
   * means the stored value and the validated value cannot drift apart.
   */
  @IsString()
  @MinLength(7)
  @MaxLength(24)
  phone: string;
}
