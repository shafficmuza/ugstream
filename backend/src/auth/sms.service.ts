import { Injectable, Logger } from '@nestjs/common';
import { SecretsService } from '../common/secrets.service';

/**
 * SMS delivery. Uses a real gateway when credentials are configured, else
 * falls back to logging the message (dev/testing). Built-in provider is
 * Africa's Talking (dominant in Uganda/EA); credentials come from the
 * admin-editable secrets store (DB → env), so they can be set in the UI or
 * .env without a redeploy. Swap `sendViaAfricasTalking` if you use another
 * gateway (Yo! SMS, Twilio, etc.).
 *
 * Keys: SMS_AT_USERNAME, SMS_AT_API_KEY, SMS_AT_SENDER_ID (optional),
 *       SMS_AT_ENV ("production" | "sandbox", default production).
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly secrets: SecretsService) {}

  /** True once a real gateway is configured (used to gate the OTP bypass). */
  async isConfigured(): Promise<boolean> {
    return (await this.secrets.isSet('SMS_AT_USERNAME')) && (await this.secrets.isSet('SMS_AT_API_KEY'));
  }

  async send(phone: string, message: string): Promise<void> {
    if (!(await this.isConfigured())) {
      // No gateway wired — log so OTP flows are testable locally.
      this.logger.warn(`[SMS STUB — no gateway configured] to ${phone}: ${message}`);
      return;
    }
    await this.sendViaAfricasTalking(phone, message);
  }

  private async sendViaAfricasTalking(phone: string, message: string): Promise<void> {
    const username = (await this.secrets.get('SMS_AT_USERNAME'))!;
    const apiKey = (await this.secrets.get('SMS_AT_API_KEY'))!;
    const senderId = await this.secrets.get('SMS_AT_SENDER_ID');
    const env = (await this.secrets.get('SMS_AT_ENV')) || 'production';
    const host =
      env === 'sandbox'
        ? 'https://api.sandbox.africastalking.com'
        : 'https://api.africastalking.com';

    const body = new URLSearchParams({ username, to: phone, message });
    if (senderId) body.set('from', senderId);

    const res = await fetch(`${host}/version1/messaging`, {
      method: 'POST',
      headers: {
        apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });
    const json: any = await res.json().catch(() => ({}));
    const recipient = json?.SMSMessageData?.Recipients?.[0];
    if (!res.ok || !recipient || recipient.status !== 'Success') {
      // Don't throw — a failed SMS shouldn't 500 the OTP request; log for ops.
      this.logger.error(`SMS send failed to ${phone}: ${JSON.stringify(json).slice(0, 300)}`);
    }
  }
}
