import { Injectable, Logger } from '@nestjs/common';
import { SecretsService } from '../common/secrets.service';
import { PrismaService } from '../prisma/prisma.service';
import { callingCode } from './phone.util';

export type SmsProvider = 'africastalking' | 'twilio' | 'custom';

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
 *   'custom'         force the configurable gateway below
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
 *   custom:         SMS_CUSTOM_URL, and optionally SMS_CUSTOM_METHOD,
 *                   SMS_CUSTOM_HEADERS, SMS_CUSTOM_BODY, SMS_CUSTOM_CONTENT_TYPE,
 *                   SMS_CUSTOM_SUCCESS_CONTAINS
 *
 * The 'custom' gateway exists so a new provider can be added from the admin
 * secrets screen without a deploy — and, more to the point, without a new
 * mobile build: the apps only ever call our own /auth/otp/request, so which
 * gateway carries the message is invisible to them. Local aggregators come and
 * go, sender IDs get approved or refused, and switching should not mean waiting
 * on an app store.
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
    if (provider === 'custom') {
      return Boolean(await this.secrets.get('SMS_CUSTOM_URL'));
    }
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

    // Order matters. Try the natural counterpart first — the routing table
    // knows AT covers East Africa and Twilio covers everywhere else — and only
    // then the custom gateway, whose coverage we cannot know. Preferring a
    // local gateway for an international number would silently fail to deliver,
    // which is the same trap the routing table exists to avoid.
    const counterpart: SmsProvider = preferred === 'twilio' ? 'africastalking' : 'twilio';
    const others: SmsProvider[] = [counterpart, 'custom'].filter(
      (p) => p !== preferred,
    ) as SmsProvider[];
    for (const fallback of others) {
      if (await this.isProviderConfigured(fallback)) {
        this.logger.warn(
          `${preferred} is not configured — sending to ${e164} via ${fallback} instead.` +
            (fallback === 'twilio'
              ? ' This costs roughly 30x more per message; configure a local gateway.'
              : ''),
        );
        return fallback;
      }
    }
    return null;
  }

  async send(phone: string, message: string): Promise<void> {
    const provider = await this.resolveProvider(phone);
    if (!provider) {
      this.logger.warn(`[SMS STUB — no gateway configured] to ${phone}: ${message}`);
      return;
    }
    if (provider === 'custom') return this.sendViaCustom(phone, message);
    if (provider === 'twilio') return this.sendViaTwilio(phone, message);
    return this.sendViaAfricasTalking(phone, message);
  }

  /**
   * A gateway defined entirely by admin settings, so a new SMS provider can be
   * added without a code change or an app release.
   *
   *   SMS_CUSTOM_URL              required, e.g. https://api.example.com/send
   *   SMS_CUSTOM_METHOD           POST (default) or GET
   *   SMS_CUSTOM_HEADERS          JSON object, e.g. {"Authorization":"Bearer x"}
   *   SMS_CUSTOM_CONTENT_TYPE     application/x-www-form-urlencoded (default)
   *                               or application/json
   *   SMS_CUSTOM_BODY             template; {to} and {message} are substituted.
   *                               Default: to={to}&message={message}
   *   SMS_CUSTOM_SUCCESS_CONTAINS optional string the response must contain to
   *                               count as sent — some gateways answer 200 with
   *                               a failure in the body, which would otherwise
   *                               look like success.
   *
   * Placeholders are URL-encoded for form bodies and JSON-escaped for JSON
   * ones, so a message containing & or " cannot corrupt the request.
   */
  private async sendViaCustom(phone: string, message: string): Promise<void> {
    const url = (await this.secrets.get('SMS_CUSTOM_URL'))!;
    const method = ((await this.secrets.get('SMS_CUSTOM_METHOD')) || 'POST').toUpperCase();
    const contentType =
      (await this.secrets.get('SMS_CUSTOM_CONTENT_TYPE')) || 'application/x-www-form-urlencoded';
    const template = (await this.secrets.get('SMS_CUSTOM_BODY')) || 'to={to}&message={message}';
    const successNeedle = await this.secrets.get('SMS_CUSTOM_SUCCESS_CONTAINS');

    let headers: Record<string, string> = {};
    const rawHeaders = await this.secrets.get('SMS_CUSTOM_HEADERS');
    if (rawHeaders) {
      try {
        headers = JSON.parse(rawHeaders);
      } catch {
        this.logger.error('SMS_CUSTOM_HEADERS is not valid JSON — sending without extra headers.');
      }
    }

    const isJson = contentType.includes('json');
    const fill = (t: string) =>
      t
        .replace(/\{to\}/g, isJson ? this.jsonEscape(phone) : encodeURIComponent(phone))
        .replace(/\{message\}/g, isJson ? this.jsonEscape(message) : encodeURIComponent(message));

    const filled = fill(template);
    const target = method === 'GET' ? `${url}${url.includes('?') ? '&' : '?'}${filled}` : url;

    try {
      const res = await fetch(target, {
        method,
        headers: method === 'GET' ? headers : { 'Content-Type': contentType, ...headers },
        body: method === 'GET' ? undefined : filled,
      });
      const text = await res.text().catch(() => '');
      const ok = res.ok && (!successNeedle || text.includes(successNeedle));
      if (!ok) {
        this.logger.error(
          `Custom SMS gateway failed for ${phone}: HTTP ${res.status} ${text.slice(0, 300)}`,
        );
      }
    } catch (e: any) {
      this.logger.error(`Custom SMS gateway unreachable for ${phone}: ${e?.message ?? e}`);
    }
  }

  /** Escape a value for interpolation into a JSON body template. */
  private jsonEscape(value: string): string {
    return JSON.stringify(value).slice(1, -1);
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
