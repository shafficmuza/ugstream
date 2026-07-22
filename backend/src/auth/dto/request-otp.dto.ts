import { IsPhoneNumber } from 'class-validator';

export class RequestOtpDto {
  @IsPhoneNumber('UG', { message: 'Enter a valid Ugandan phone number, e.g. +256700000000' })
  phone: string;
}
