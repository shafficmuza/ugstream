import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecretsService } from '../common/secrets.service';

/**
 * Yo! Payments (Uganda) mobile-money collections via their XML API.
 * Like MTN MoMo there's no hosted page — `acdepositfunds` pulls money from
 * the customer's mobile-money account (they approve on their phone), and we
 * poll `actransactioncheckstatus` for the result.
 *
 * API reference: https://www.yo.co.ug (Yo Payments API, XML over HTTPS POST).
 * Credentials come from env (YO_API_USERNAME / YO_API_PASSWORD); the live vs
 * sandbox host is YO_API_URL. NOTE: verify against Yo's sandbox with real
 * credentials before go-live — field names below follow their documented API.
 */
@Injectable()
export class YoService {
  constructor(
    private readonly config: ConfigService,
    private readonly secrets: SecretsService,
  ) {}

  /** Credential from the admin-editable secrets store (DB → env). */
  private async cred(key: string): Promise<string> {
    const v = await this.secrets.get(key);
    if (!v) throw new InternalServerErrorException(`Missing payment credential: ${key}`);
    return v;
  }

  /** Whether both credentials are present (UI-entered or env). */
  async isConfigured(): Promise<boolean> {
    return (await this.secrets.isSet('YO_API_USERNAME')) && (await this.secrets.isSet('YO_API_PASSWORD'));
  }

  private async apiUrl(): Promise<string> {
    return (await this.secrets.get('YO_API_URL')) || 'https://paymentsapi1.yo.co.ug/ybs/task.php';
  }

  /** Where Yo should POST the IPN for THIS project's transactions. Per-request
   *  so a shared Yo account still notifies each project's own endpoint. */
  private async ipnUrl(): Promise<string> {
    return (await this.secrets.get('YO_IPN_URL')) || 'https://ham.sentepos.com/api/v1/webhooks/yo';
  }

  /** Minimal XML tag reader — Yo responses are flat, no nesting to speak of. */
  private tag(xml: string, name: string): string | undefined {
    const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
    return m?.[1]?.trim();
  }

  private async post(xml: string): Promise<string> {
    const res = await fetch(await this.apiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml', Accept: 'text/xml' },
      body: xml,
    });
    const text = await res.text();
    if (!res.ok) throw new InternalServerErrorException(`Yo API HTTP ${res.status}: ${text.slice(0, 300)}`);
    return text;
  }

  /**
   * Request a deposit (pull) from the customer's mobile-money account.
   * Returns Yo's TransactionReference to poll on. Async: the customer must
   * approve on their phone, so the initial status is typically PENDING.
   */
  async requestPayment(params: {
    amount: number;
    msisdn: string;
    narrative: string;
    externalRef: string;
  }): Promise<{ transactionRef: string; status: 'PENDING' | 'SUCCESSFUL' | 'FAILED' }> {
    const username = await this.cred('YO_API_USERNAME');
    const password = await this.cred('YO_API_PASSWORD');
    const ipn = await this.ipnUrl();
    const msisdn = params.msisdn.replace(/^\+/, ''); // digits only

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<AutoCreate><Request>` +
      `<APIUsername>${username}</APIUsername>` +
      `<APIPassword>${password}</APIPassword>` +
      `<Method>acdepositfunds</Method>` +
      `<NonBlocking>TRUE</NonBlocking>` +
      `<Amount>${params.amount}</Amount>` +
      `<Account>${msisdn}</Account>` +
      `<Narrative>${this.escape(params.narrative)}</Narrative>` +
      `<ExternalReference>${this.escape(params.externalRef)}</ExternalReference>` +
      // Tell Yo to POST the IPN to this project's endpoint (both success and
      // failure) — keeps a shared Yo account routing notifications per-project.
      `<InstantNotificationUrl>${this.escape(ipn)}</InstantNotificationUrl>` +
      `<FailureNotificationUrl>${this.escape(ipn)}</FailureNotificationUrl>` +
      `</Request></AutoCreate>`;

    const resp = await this.post(xml);
    const status = this.tag(resp, 'Status');
    const ref = this.tag(resp, 'TransactionReference') ?? params.externalRef;
    if (status && !['OK', 'PENDING'].includes(status.toUpperCase())) {
      const msg = this.tag(resp, 'StatusMessage') ?? status;
      throw new InternalServerErrorException(`Yo deposit rejected: ${msg}`);
    }
    return { transactionRef: ref, status: 'PENDING' };
  }

  /** Poll a transaction: PENDING | SUCCESSFUL | FAILED. */
  async getStatus(transactionRef: string): Promise<{ status: 'PENDING' | 'SUCCESSFUL' | 'FAILED' }> {
    const username = await this.cred('YO_API_USERNAME');
    const password = await this.cred('YO_API_PASSWORD');

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<AutoCreate><Request>` +
      `<APIUsername>${username}</APIUsername>` +
      `<APIPassword>${password}</APIPassword>` +
      `<Method>actransactioncheckstatus</Method>` +
      `<TransactionReference>${this.escape(transactionRef)}</TransactionReference>` +
      `</Request></AutoCreate>`;

    const resp = await this.post(xml);
    // TransactionStatus: SUCCEEDED | FAILED | PENDING | INDETERMINATE
    const ts = (this.tag(resp, 'TransactionStatus') ?? '').toUpperCase();
    if (ts === 'SUCCEEDED') return { status: 'SUCCESSFUL' };
    if (ts === 'FAILED') return { status: 'FAILED' };
    return { status: 'PENDING' };
  }

  private escape(s: string): string {
    return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
  }
}
