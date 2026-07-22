import { Injectable, Logger } from '@nestjs/common';

/**
 * SMS delivery abstraction. Swap the body of `send` for a real gateway
 * (Africa's Talking, Yo! SMS, etc.) before going to production — for now
 * it just logs the code so OTP flows are testable end-to-end locally.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  async send(phone: string, message: string): Promise<void> {
    this.logger.warn(`[SMS STUB] to ${phone}: ${message}`);
  }
}
