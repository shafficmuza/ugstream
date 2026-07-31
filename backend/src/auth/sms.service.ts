import { Injectable, Logger } from '@nestjs/common';
import { SecretsService } from '../common/secrets.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * SMS delivery for OTP. Two gateways supported — Africa's Talking and Twilio
 * — selected by AppSettings.smsProvider (admin UI). Credentials come from the
 * admin-editable secrets store (DB → env). If the active provider isn't
 * configured, falls back to logging the message (dev/testing).
 *
 * Keys:
 *   africastalking: SMS_AT_USERNAME, SMS_AT_API_KEY, SMS_AT_SENDER_ID?, SMS_AT_ENV?
 *   twilio:         SMS_TWILIO_ACCOUNT_SID, SMS_TWILIO_AUTH_TOKEN, SMS_TWILIO_FROM
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(
    private readonly secrets: SecretsService,
    private readonly prisma: PrismaService,
  ) {}

  private async provider(): Promise<'africastalking' | 'twilio'> {
    const s = await this.prisma.appSettings.findUnique({ where: { id: 1 } });
    return s?.smsProvider === 'twilio' ? 'twilio' : 'africastalking';
  }

  /** True once the active provider's credentials are present. */
  async isConfigured(): Promise<boolean> {
    if ((await this.provider()) === 'twilio') {
      return (
        (await this.secrets.isSet('SMS_TWILIO_ACCOUNT_SID')) &&
        (await this.secrets.isSet('SMS_TWILIO_AUTH_TOKEN')) &&
        (await this.secrets.isSet('SMS_TWILIO_FROM'))
      );
    }
    return (await this.secrets.isSet('SMS_AT_USERNAME')) && (await this.secrets.isSet('SMS_AT_API_KEY'));
  }

  async send(phone: string, message: string): Promise<void> {
    if (!(await this.isConfigured())) {
      this.logger.warn(`[SMS STUB — gateway not configured] to ${phone}: ${message}`);
      return;
    }
    if ((await this.provider()) === 'twilio') return this.sendViaTwilio(phone, message);
    return this.sendViaAfricasTalking(phone, message);
  }

  private async sendViaTwilio(phone: string, message: string): Promise<void> {
    const sid = (await this.secrets.get('SMS_TWILIO_ACCOUNT_SID'))!;
    const token = (await this.secrets.get('SMS_TWILIO_AUTH_TOKEN'))!;
    const from = (await this.secrets.get('SMS_TWILIO_FROM'))!;

    const body = new URLSearchParams({ To: phone, From: from, Body: message });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Twilio SMS failed to ${phone}: HTTP ${res.status} ${text.slice(0, 300)}`);
    }
  }

  private async sendViaAfricasTalking(phone: string, message: string): Promise<void> {
    const username = (await this.secrets.get('SMS_AT_USERNAME'))!;
    const apiKey = (await this.secrets.get('SMS_AT_API_KEY'))!;
    const senderId = await this.secrets.get('SMS_AT_SENDER_ID');
    const env = (await this.secrets.get('SMS_AT_ENV')) || 'production';
    const host = env === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';

    const body = new URLSearchParams({ username, to: phone, message });
    if (senderId) body.set('from', senderId);

    const res = await fetch(`${host}/version1/messaging`, {
      method: 'POST',
      headers: { apiKey, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    });
    const json: any = await res.json().catch(() => ({}));
    const recipient = json?.SMSMessageData?.Recipients?.[0];
    if (!res.ok || !recipient || recipient.status !== 'Success') {
      this.logger.error(`Africa's Talking SMS failed to ${phone}: ${JSON.stringify(json).slice(0, 300)}`);
    }
  }
}
