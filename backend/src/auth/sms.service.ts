import { Injectable, Logger } from '@nestjs/common';
import { SecretsService } from '../common/secrets.service';
import { PrismaService } from '../prisma/prisma.service';
import { callingCode } from './phone.util';

export type SmsProvider = 'routemobile' | 'bulksms' | 'africastalking' | 'twilio' | 'custom';

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
 * Country calling codes BulkSMS will not deliver to.
 *
 * BulkSMS covers Uganda and essentially everywhere else, but not the USA or
 * Canada — both of which are +1. Every +1 number therefore routes to Twilio
 * instead, including the Caribbean countries that share the code: Twilio
 * covers those too, so sending all of +1 there is correct as well as simpler
 * than an area-code table.
 *
 * This is enforced as provider *coverage*, not just as a routing preference,
 * so forcing the provider from the admin screen cannot strand a US number on a
 * gateway that will never deliver to it.
 */
const BULKSMS_EXCLUDED_MARKETS: Record<string, string> = {
  '1': 'USA and Canada',
};

/**
 * Ugandan Airtel mobile prefixes — the ONLY numbers RouteMobile is trusted with.
 *
 * Tested live against both carriers on 2026-08-15: Airtel arrived, MTN did
 * not. RouteMobile answered `1701` (its success code) for BOTH, so nothing in
 * the response distinguishes the delivered message from the lost one. That is
 * the worst shape a gateway failure can take — silent — and it is why this is
 * a positive list of what was PROVEN rather than an exclusion list of what
 * failed. MTN stays on BulkSMS until RouteMobile's MTN route is fixed;
 * re-test on a handset before adding 77/78/76/39.
 */
const ROUTEMOBILE_AIRTEL_UG = /^\+256(70|74|75)/;

/**
 * Warn once BulkSMS credit falls below this.
 *
 * Expressed in credits rather than messages because the per-message cost is
 * country-dependent — a code to Uganda costs 9 credits, so this is roughly 40
 * sign-ins there and more elsewhere. Deliberately generous: the useful warning
 * is the one that arrives with days to act on it, not the one at zero.
 */
const LOW_BALANCE_CREDITS = 360;

/** How often the balance is actually fetched, regardless of send volume. */
const BALANCE_CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * SMS delivery for OTP. Two gateways — Africa's Talking and Twilio — selected
 * per recipient by AppSettings.smsProvider:
 *
 *   'auto'           BulkSMS everywhere it delivers, Twilio for +1 and for
 *                    anything unparseable
 *   'africastalking' force Africa's Talking for every number
 *   'twilio'         force Twilio for every number
 *   'routemobile'    force RouteMobile (only reaches Airtel Uganda)
 *   'bulksms'        force BulkSMS for every number
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
 *   bulksms:        SMS_BULKSMS_TOKEN_ID, SMS_BULKSMS_TOKEN_SECRET, and
 *                   optionally SMS_BULKSMS_SENDER_ID (must be registered)
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
  private lastBalanceCheck = 0;

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
    if (provider === 'routemobile') {
      return (
        (await this.secrets.isSet('SMS_RML_USERNAME')) && (await this.secrets.isSet('SMS_RML_PASSWORD'))
      );
    }
    if (provider === 'bulksms') {
      return (
        (await this.secrets.isSet('SMS_BULKSMS_TOKEN_ID')) &&
        (await this.secrets.isSet('SMS_BULKSMS_TOKEN_SECRET'))
      );
    }
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
    for (const p of ['bulksms', 'africastalking', 'twilio', 'custom'] as SmsProvider[]) {
      if (await this.isProviderConfigured(p)) return true;
    }
    return false;
  }

  /**
   * Which provider a number routes to on price grounds, before considering
   * whether that provider is actually configured. Pure and side-effect free so
   * the routing table can be tested directly.
   */
  routeFor(e164: string, mode: 'auto' | SmsProvider): SmsProvider {
    if (mode !== 'auto') return mode;
    // Airtel Uganda rides RouteMobile — the user's own platform, proven on
    // that carrier and cheaper than BulkSMS's 9 credits. BulkSMS keeps MTN
    // (confirmed DLR there) and the diaspora. Twilio takes the +1 numbers
    // BulkSMS cannot reach, and anything unparseable, since a number we
    // failed to read is safest on the gateway with global coverage.
    if (ROUTEMOBILE_AIRTEL_UG.test(e164)) return 'routemobile';
    return this.canDeliverTo('bulksms', e164) ? 'bulksms' : 'twilio';
  }

  /**
   * Whether a provider can reach this number at all — a question of coverage,
   * separate from whether it is configured or what it costs.
   *
   * Routing to a gateway that cannot deliver to a country is the failure mode
   * worth engineering against here: the API accepts the request, returns
   * success, and the user simply never receives a code. Nothing appears in the
   * logs as an error, so it presents as "login is broken" with no cause.
   */
  private canDeliverTo(provider: SmsProvider, e164: string): boolean {
    const code = callingCode(e164);
    if (!code) return provider === 'twilio'; // unparseable — only the global one
    if (provider === 'routemobile') return ROUTEMOBILE_AIRTEL_UG.test(e164);
    if (provider === 'bulksms') return !BULKSMS_EXCLUDED_MARKETS[code];
    if (provider === 'africastalking') return Boolean(AFRICAS_TALKING_MARKETS[code]);
    return true; // Twilio is global; a custom gateway's coverage is unknowable
  }

  /** Routed provider, downgraded to whatever is actually usable. */
  private async resolveChain(e164: string): Promise<SmsProvider[]> {
    const chain: SmsProvider[] = [];
    const preferred = this.routeFor(e164, await this.routingMode());
    if (this.canDeliverTo(preferred, e164) && (await this.isProviderConfigured(preferred))) {
      chain.push(preferred);
    }
    if (!this.canDeliverTo(preferred, e164)) {
      this.logger.warn(
        `${preferred} does not deliver to ${callingCode(e164)} — routing ${e164} elsewhere.`,
      );
    }

    // Order matters, and it is cost order among the gateways that can actually
    // reach this number: Africa's Talking is the cheapest where it operates,
    // BulkSMS next and worldwide, Twilio last because it is ~30x AT's rate.
    // The custom gateway trails everything, because its coverage is whatever an
    // admin typed into a settings field and cannot be reasoned about — sending
    // an international number to a local gateway fails silently, which is the
    // trap this whole ordering exists to avoid.
    // Ordered by PROVEN delivery, not by price. Africa's Talking is last
    // despite being the cheapest: it accepts messages and they do not arrive
    // (its sender ID is still unregistered, and delivery dies downstream at
    // the Ugandan carriers). It sat first here on cost grounds, so the first
    // real failover — RouteMobile refusing an Airtel number — handed the code
    // to the one gateway guaranteed not to deliver it, and the user got
    // nothing while every log line said success. A cheap message that never
    // arrives is not cheap; it is a lost sign-in.
    const order: SmsProvider[] = ['routemobile', 'bulksms', 'twilio', 'custom', 'africastalking'];
    for (const fallback of order) {
      if (fallback === preferred) continue;
      if (!this.canDeliverTo(fallback, e164)) continue;
      if (await this.isProviderConfigured(fallback)) chain.push(fallback);
    }
    return chain;
  }

  /**
   * Deliver a code, trying each usable gateway in turn until one accepts it.
   *
   * Walking the chain on *failure* matters as much as routing correctly in the
   * first place. The primary gateway running out of credit, having its token
   * revoked, or simply being down is not a rare event, and the consequence is
   * not a degraded experience — it is every user unable to sign in, with no
   * error visible to them and nothing to retry. Paying Twilio's rate for a
   * handful of messages is unambiguously cheaper than an authentication
   * outage.
   */
  async send(phone: string, message: string): Promise<void> {
    const chain = await this.resolveChain(phone);
    if (chain.length === 0) {
      this.logger.warn(`[SMS STUB — no gateway configured] to ${phone}: ${message}`);
      return;
    }

    for (const [i, provider] of chain.entries()) {
      if (i > 0) {
        this.logger.warn(
          `${chain[i - 1]} did not deliver to ${phone} — retrying via ${provider}.` +
            (provider === 'twilio' ? ' This costs roughly 30x more per message.' : ''),
        );
      }
      if (await this.sendVia(provider, phone, message)) return;
    }

    this.logger.error(
      `Every gateway failed for ${phone} (tried ${chain.join(', ')}). The user cannot sign in.`,
    );
  }

  private async sendVia(provider: SmsProvider, phone: string, message: string): Promise<boolean> {
    if (provider === 'routemobile') return this.sendViaRouteMobile(phone, message);
    if (provider === 'bulksms') return this.sendViaBulkSms(phone, message);
    if (provider === 'custom') return this.sendViaCustom(phone, message);
    if (provider === 'twilio') return this.sendViaTwilio(phone, message);
    return this.sendViaAfricasTalking(phone, message);
  }

  /**
   * Route Mobile, via the credentials of the user's own SMS Vibe platform.
   *
   * One GET; the reply is `statusCode|destination|messageId`, where 1701 is
   * the only success. Everything else — wrong credentials (1703/1704),
   * dead balance, unknown destination — comes back as a different code on an
   * HTTP 200, so the status CODE is the truth and the HTTP status is noise.
   */
  private async sendViaRouteMobile(phone: string, message: string): Promise<boolean> {
    const username = (await this.secrets.get('SMS_RML_USERNAME'))!;
    const password = (await this.secrets.get('SMS_RML_PASSWORD'))!;
    const endpoint =
      (await this.secrets.get('SMS_RML_ENDPOINT')) || 'https://dstr.connectbind.com:8443/sendsms';
    const source = (await this.secrets.get('SMS_RML_SENDER_ID')) || 'PROMEDIA';

    // RouteMobile wants bare digits, no '+'.
    const destination = phone.replace(/^\+/, '');
    const params = new URLSearchParams({
      username,
      password,
      type: '0',
      dlr: '1',
      destination,
      source,
      message,
    });

    try {
      const res = await fetch(`${endpoint}?${params}`);
      const text = (await res.text().catch(() => '')).trim();
      const code = text.split('|')[0]?.trim();
      if (code === '1701') return true;
      this.logger.error(`RouteMobile refused ${phone}: ${text.slice(0, 200) || `HTTP ${res.status}`}`);
      return false;
    } catch (e: any) {
      this.logger.error(`RouteMobile unreachable for ${phone}: ${e?.message ?? e}`);
      return false;
    }
  }

  /**
   * BulkSMS (bulksms.com). One JSON POST, HTTP Basic auth with a token ID and
   * secret rather than the account password, so the credential can be revoked
   * without changing the login.
   *
   * Delivery is international, so unlike Africa's Talking there is no market
   * restriction to route around. A send is accepted with 201; the body carries
   * a per-message status, and a 200-class response with a failed message inside
   * it would otherwise read as delivered — so the status is checked, not just
   * the code.
   */
  private async sendViaBulkSms(phone: string, message: string): Promise<boolean> {
    const id = (await this.secrets.get('SMS_BULKSMS_TOKEN_ID'))!;
    const secret = (await this.secrets.get('SMS_BULKSMS_TOKEN_SECRET'))!;
    const senderId = await this.secrets.get('SMS_BULKSMS_SENDER_ID');
    const auth = Buffer.from(`${id}:${secret}`).toString('base64');

    // `from` is omitted entirely when unset, rather than sent empty: that
    // routes the message over the shared numeric pool, which always works.
    // A sender ID must be registered on the account first — an unregistered
    // one is rejected outright, turning a working gateway into a total sign-in
    // outage. This is what happened on Africa's Talking with AFRICASTKNG.
    const payload: Record<string, string> = { to: phone, body: message };
    if (senderId) payload.from = senderId;

    try {
      const res = await fetch('https://api.bulksms.com/v1/messages', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const text = await res.text().catch(() => '');

      if (!res.ok) {
        // 401 means the token pair is wrong; 402 means the account is out of
        // credit. Both look identical to a user — no code arrives — so the
        // reason belongs in the log where it can be acted on.
        if (res.status === 402) {
          this.logger.error(
            `BulkSMS is OUT OF CREDIT — ${phone} received no code. Top up at bulksms.com.`,
          );
        } else {
          this.logger.error(`BulkSMS failed for ${phone}: HTTP ${res.status} ${text.slice(0, 300)}`);
        }
        return false;
      }

      // A submission can be accepted overall while the individual message is
      // rejected, e.g. for an unroutable number.
      const failed = /"type"\s*:\s*"FAILED"/i.test(text);
      if (failed) {
        this.logger.error(`BulkSMS rejected the message to ${phone}: ${text.slice(0, 300)}`);
        return false;
      }
      this.warnIfLowBalance();
      return true;
    } catch (e: any) {
      this.logger.error(`BulkSMS unreachable for ${phone}: ${e?.message ?? e}`);
      return false;
    }
  }

  /**
   * Shout while there is still time to act on it.
   *
   * A message to Uganda costs 9 credits, so a balance that looks healthy is a
   * fortnight of logins, not a year of them. Running dry locks every user out
   * of their own account with no error they can see and nothing in the app to
   * suggest what is wrong, so the warning has to arrive before zero, not at it.
   */
  private warnIfLowBalance(): void {
    const now = Date.now();
    if (now - this.lastBalanceCheck < BALANCE_CHECK_INTERVAL_MS) return;
    this.lastBalanceCheck = now;

    // Fire and forget: the code has already been sent, and a balance lookup
    // must never delay or fail a login.
    void this.bulkSmsBalance().then((balance) => {
      if (balance === null || balance >= LOW_BALANCE_CREDITS) return;
      this.logger.error(
        `BulkSMS balance is LOW: ${balance} credits (~${Math.floor(balance / 9)} more codes to ` +
          `Uganda). Top up at bulksms.com — at zero, nobody can sign in.`,
      );
    });
  }

  /** Remaining BulkSMS credits, or null if the account cannot be read. */
  private async bulkSmsBalance(): Promise<number | null> {
    try {
      const id = await this.secrets.get('SMS_BULKSMS_TOKEN_ID');
      const secret = await this.secrets.get('SMS_BULKSMS_TOKEN_SECRET');
      if (!id || !secret) return null;
      const res = await fetch('https://api.bulksms.com/v1/profile', {
        headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` },
      });
      if (!res.ok) return null;
      const json: any = await res.json();
      return typeof json?.credits?.balance === 'number' ? json.credits.balance : null;
    } catch {
      return null;
    }
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
  private async sendViaCustom(phone: string, message: string): Promise<boolean> {
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
      return ok;
    } catch (e: any) {
      this.logger.error(`Custom SMS gateway unreachable for ${phone}: ${e?.message ?? e}`);
      return false;
    }
  }

  /** Escape a value for interpolation into a JSON body template. */
  private jsonEscape(value: string): string {
    return JSON.stringify(value).slice(1, -1);
  }

  private async sendViaTwilio(phone: string, message: string): Promise<boolean> {
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
      return false;
    }
    return true;
  }

  private async sendViaAfricasTalking(phone: string, message: string): Promise<boolean> {
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
      return false;
    }
    return true;
  }
}
