import { Injectable, Logger } from '@nestjs/common';
import { SecretsService } from '../common/secrets.service';
import { PrismaService } from '../prisma/prisma.service';
import { callingCode } from './phone.util';

/**
 * Marks an `otp_codes` row whose code lives at Twilio rather than here.
 *
 * The row still exists because the per-number rate limits count rows — it is
 * the accounting record for a code that was paid for — but it carries no
 * usable hash, and verification for it goes over the network.
 */
export const TWILIO_VERIFY_PROVIDER = 'twilioverify';

/**
 * Country calling codes routed to Twilio Verify when routing is 'auto'.
 *
 * Only +1: the USA, Canada and the Caribbean countries that share the code.
 * These are precisely the numbers BulkSMS refuses (see BULKSMS_EXCLUDED_MARKETS
 * in sms.service), so they were already the expensive ones going out over
 * plain Twilio SMS — moving them to Verify costs a little more per sign-in and
 * buys sender registration, carrier-level retries and Fraud Guard on the one
 * market where we have no local gateway and no way to test delivery.
 *
 * Uganda and the rest of Africa deliberately stay on RouteMobile/BulkSMS.
 * Verify is priced per verification on top of the message, which at UGX 1,000
 * a day plan would cost more than the sale grosses — the same arithmetic that
 * keeps Twilio SMS out of Uganda today.
 */
const TWILIO_VERIFY_MARKETS: Record<string, string> = {
  '1': 'USA, Canada and the Caribbean',
};

/**
 * Phone verification through Twilio Verify.
 *
 * Different in kind from every gateway in SmsService: those carry a message we
 * wrote, this one carries no message at all. Twilio generates the code, holds
 * it, delivers it over its own registered sender pool and checks it back — so
 * the code never exists on this server and there is nothing here to hash,
 * store or compare.
 *
 * That is the whole reason to use it for +1. A message we hand to a gateway
 * for a country we cannot test from either arrives or vanishes, and both look
 * identical in the logs; Verify's answer to "was this code correct" is
 * authoritative, and its delivery is Twilio's problem rather than ours.
 *
 * Credentials (admin-editable secrets store, DB → env):
 *   SMS_TWILIO_ACCOUNT_SID       shared with the plain Twilio SMS gateway
 *   SMS_TWILIO_AUTH_TOKEN        likewise
 *   SMS_TWILIO_VERIFY_SERVICE_SID  VAxxxx…, from Console → Verify → Services
 *
 * SMS_TWILIO_FROM is NOT used here — Verify owns the sender. The service's
 * friendly name is what appears in the message body, so it is set in the
 * Twilio console, not in this codebase.
 *
 * Every failure path returns false rather than throwing: a Verify outage must
 * degrade to an ordinary SMS code, not to a sign-in outage for North America.
 */
@Injectable()
export class TwilioVerifyService {
  private readonly logger = new Logger(TwilioVerifyService.name);

  constructor(
    private readonly secrets: SecretsService,
    private readonly prisma: PrismaService,
  ) {}

  /** True once the Verify service and its credentials are all present. */
  async isConfigured(): Promise<boolean> {
    return (
      (await this.secrets.isSet('SMS_TWILIO_ACCOUNT_SID')) &&
      (await this.secrets.isSet('SMS_TWILIO_AUTH_TOKEN')) &&
      (await this.secrets.isSet('SMS_TWILIO_VERIFY_SERVICE_SID'))
    );
  }

  /**
   * Whether this number's code should be issued by Verify rather than by us.
   *
   * Pure routing, deliberately narrow:
   *
   *   'auto'          +1 only — the market with no local gateway
   *   'twilioverify'  every number, for an outage of everything else
   *   anything else   never; the admin has forced a specific gateway and
   *                   Verify is not one, so the message path decides
   *
   * `handles` is exposed separately so the table can be tested without a
   * database.
   */
  handles(e164: string, mode: string): boolean {
    if (mode === TWILIO_VERIFY_PROVIDER) return true;
    if (mode !== 'auto') return false;
    return Boolean(TWILIO_VERIFY_MARKETS[callingCode(e164)]);
  }

  /** As {@link handles}, against the live setting, and only if usable. */
  async shouldUseFor(e164: string): Promise<boolean> {
    const settings = await this.prisma.appSettings.findUnique({ where: { id: 1 } });
    if (!this.handles(e164, settings?.smsProvider ?? 'auto')) return false;
    return this.isConfigured();
  }

  /**
   * Ask Twilio to generate and deliver a code.
   *
   * False means nothing was sent and the caller must fall back to an ordinary
   * SMS code — including on 429, which Verify returns when a code was already
   * sent to this number within its own rate window. Our per-number limits run
   * first and are stricter, so reaching that is a sign of a number being
   * hammered rather than a legitimate resend.
   */
  async start(e164: string): Promise<boolean> {
    const creds = await this.credentials();
    if (!creds) return false;

    try {
      const res = await fetch(
        `https://verify.twilio.com/v2/Services/${creds.serviceSid}/Verifications`,
        {
          method: 'POST',
          headers: {
            Authorization: creds.auth,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ To: e164, Channel: 'sms' }).toString(),
        },
      );
      const text = await res.text().catch(() => '');
      if (!res.ok) {
        // 60200 is a malformed number, 60410 a blocked one, 20404 a wrong
        // service SID — all indistinguishable to the user, who simply gets no
        // code, so the reason belongs in the log.
        this.logger.error(
          `Twilio Verify would not start for ${e164}: HTTP ${res.status} ${text.slice(0, 300)}`,
        );
        return false;
      }
      // 'pending' is the only status that means a code is on its way. Anything
      // else (canceled, max_attempts_reached) is not a delivery.
      if (!/"status"\s*:\s*"pending"/i.test(text)) {
        this.logger.error(`Twilio Verify did not send to ${e164}: ${text.slice(0, 300)}`);
        return false;
      }
      return true;
    } catch (e: any) {
      this.logger.error(`Twilio Verify unreachable for ${e164}: ${e?.message ?? e}`);
      return false;
    }
  }

  /**
   * Check a code against Twilio. True only on an explicit approval.
   *
   * A 404 here is ordinary, not exceptional: Twilio deletes the verification
   * once it is approved, expires, or runs out of attempts, and answers 404 for
   * any of those. Treating it as an error would turn "your code expired" into
   * a 500; it is simply not approved.
   */
  async check(e164: string, code: string): Promise<boolean> {
    const creds = await this.credentials();
    if (!creds) return false;

    try {
      const res = await fetch(
        `https://verify.twilio.com/v2/Services/${creds.serviceSid}/VerificationCheck`,
        {
          method: 'POST',
          headers: {
            Authorization: creds.auth,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ To: e164, Code: code }).toString(),
        },
      );
      const text = await res.text().catch(() => '');
      if (!res.ok) {
        if (res.status !== 404) {
          this.logger.error(
            `Twilio Verify check failed for ${e164}: HTTP ${res.status} ${text.slice(0, 300)}`,
          );
        }
        return false;
      }
      return /"status"\s*:\s*"approved"/i.test(text);
    } catch (e: any) {
      // A network failure must not read as a wrong code — but it cannot read
      // as a correct one either, so it is a refusal with a loud log line.
      this.logger.error(`Twilio Verify unreachable checking ${e164}: ${e?.message ?? e}`);
      return false;
    }
  }

  private async credentials(): Promise<{ auth: string; serviceSid: string } | null> {
    const sid = await this.secrets.get('SMS_TWILIO_ACCOUNT_SID');
    const token = await this.secrets.get('SMS_TWILIO_AUTH_TOKEN');
    const serviceSid = await this.secrets.get('SMS_TWILIO_VERIFY_SERVICE_SID');
    if (!sid || !token || !serviceSid) return null;
    return {
      auth: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      serviceSid,
    };
  }
}
