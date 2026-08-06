import { Injectable, Logger } from '@nestjs/common';
import { SecretsService } from '../common/secrets.service';
import { PrismaService } from '../prisma/prisma.service';
import { callingCode } from './phone.util';

export type SmsProvider = 'africastalking' | 'twilio';

/**
 * Country calling codes routed to Africa's Talking when routing is 'auto'.
 *
 * These are the East African markets where AT charges roughly UGX 30 a message
 * (~$0.01) against Twilio's ~$0.30 international rate — a ~30x difference that
 * matters enormously at our price points: a single Twilio message to Uganda
 * costs more than the entire UGX 1,000 Daily plan grosses.
 *
 * Everywhere else — the diaspora, which is where the Monthly subscribers are —
 * Twilio is both cheaper (US/UK numbers are under a cent) and far more likely
 * to actually deliver, so it takes everything not listed here.
 *
 * Extend this list only for countries Africa's Talking genuinely covers;
 * routing a number to a provider that cannot deliver it fails login silently
 * from the user's point of view.
 */
const AFRICAS_TALKING_MARKETS: Record<string, string> = {
  '256': 'Uganda',
  '254': 'Kenya',
  '255': 'Tanzania',
  '250': 'Rwanda',
};

/**
 * SMS delivery for OTP. Two gateways — Africa's Talking and Twilio — selected
 * per recipient by AppSettings.smsProvider:
 *
 *   'auto'           route by country code (see AFRICAS_TALKING_MARKETS)
 *   'africastalking' force Africa's Talking for every number
 *   'twilio'         force Twilio for every number
 *
 * The forced modes exist for outages and for deployments that only ever hold
 * one provider's credentials. 'auto' is the default and the only mode that is
 * both cheap domestically and deliverable internationally.
 *
 * Credentials come from the admin-editable secrets store (DB → env). If the
 * routed provider isn't configured we fall back to the other one rather than
 * dropping the message: paying more to deliver a login code beats not
 * delivering it. If neither is configured, the message is logged and nothing
 * is sent (dev/testing).
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

  /** Admin-selected routing mode. */
  private async routingMode(): Promise<'auto' | SmsProvider> {
    const s = await this.prisma.appSettings.findUnique({ where: { id: 1 } });
    const mode = s?.smsProvider;
    return mode === 'twilio' || mode === 'africastalking' ? mode : 'auto';
  }

  /** True once a given provider's credentials are all present. */
  async isProviderConfigured(provider: SmsProvider): Promise<boolean> {
    if (provider === 'twilio') {
      return (
        (await this.secrets.isSet('SMS_TWILIO_ACCOUNT_SID')) &&
        (await this.secrets.isSet('SMS_TWILIO_AUTH_TOKEN')) &&
        (await this.secrets.isSet('SMS_TWILIO_FROM'))
      );
    }
    return (await this.secrets.isSet('SMS_AT_USERNAME')) && (await this.secrets.isSet('SMS_AT_API_KEY'));
  }

  /**
   * True once *any* gateway can send. Deliberately not per-provider: this is
   * what disables the OTP_STATIC_CODE login bypass (see auth.service), and the
   * bypass must switch off the moment real codes can reach anyone at all.
   */
  async isConfigured(): Promise<boolean> {
    return (
      (await this.isProviderConfigured('africastalking')) || (await this.isProviderConfigured('twilio'))
    );
  }

  /**
   * Which provider a number routes to on price grounds, before considering
   * whether that provider is actually configured. Pure and side-effect free so
   * the routing table can be tested directly.
   */
  routeFor(e164: string, mode: 'auto' | SmsProvider): SmsProvider {
    if (mode !== 'auto') return mode;
    return AFRICAS_TALKING_MARKETS[callingCode(e164)] ? 'africastalking' : 'twilio';
  }

  /** Routed provider, downgraded to whatever is actually usable. */
  private async resolveProvider(e164: string): Promise<SmsProvider | null> {
    const preferred = this.routeFor(e164, await this.routingMode());
    if (await this.isProviderConfigured(preferred)) return preferred;

    const fallback: SmsProvider = preferred === 'twilio' ? 'africastalking' : 'twilio';
    if (await this.isProviderConfigured(fallback)) {
      this.logger.warn(
        `${preferred} is not configured — sending to ${e164} via ${fallback} instead. ` +
          (fallback === 'twilio'
            ? 'This costs roughly 30x more per message; configure Africa’s Talking.'
            : 'Delivery outside East Africa is unreliable on this provider; configure Twilio.'),
      );
      return fallback;
    }
    return null;
  }

  async send(phone: string, message: string): Promise<void> {
    const provider = await this.resolveProvider(phone);
    if (!provider) {
      this.logger.warn(`[SMS STUB — no gateway configured] to ${phone}: ${message}`);
      return;
    }
    if (provider === 'twilio') return this.sendViaTwilio(phone, message);
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
