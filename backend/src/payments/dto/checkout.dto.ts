import { IsIn, IsInt, IsOptional, IsString, Matches } from 'class-validator';

export class CheckoutDto {
  @IsIn(['subscription', 'title'])
  purpose: 'subscription' | 'title';

  @IsOptional()
  @IsInt()
  planId?: number;

  @IsOptional()
  @IsString()
  titleId?: string;

  @IsOptional()
  @IsIn(['card', 'mobile_money'])
  method?: 'card' | 'mobile_money';

  @IsOptional()
  @IsIn(['flutterwave', 'stripe', 'momo', 'yo', 'dpo'])
  provider?: 'flutterwave' | 'stripe' | 'momo' | 'yo' | 'dpo';

  // Loose phone check; the service normalizes/validates the Ugandan format.
  @IsOptional()
  @IsString()
  @Matches(/^[+0-9][0-9\s-]{6,15}$/, { message: 'Invalid phone number.' })
  payerPhone?: string;
}

export class SetCredentialsDto {
  @IsOptional()
  values?: Record<string, string>;
}
