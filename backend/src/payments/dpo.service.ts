import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SecretsService } from '../common/secrets.service';

/**
 * DPO Pay (Direct Pay Online) via their v6 XML API. Two-step, hosted-page
 * flow (works for card AND mobile money on DPO's side, but we use it as a
 * mobile-money option here): createToken → redirect the payer to DPO's
 * payment page → verifyToken to confirm. Mirrors the Flutterwave/Stripe
 * "hosted checkout URL + poll/verify" shape.
 *
 * API reference: https://docs.dpopay.com (API v6, XML over HTTPS POST to
 * secure.3gdirectpay.com). Credentials from env (DPO_COMPANY_TOKEN /
 * DPO_SERVICE_TYPE). NOTE: verify against DPO's test company token before
 * go-live — Result codes and field names below follow their documented API.
 */
@Injectable()
export class DpoService {
  constructor(
    private readonly config: ConfigService,
    private readonly secrets: SecretsService,
  ) {}

  private async cred(key: string): Promise<string> {
    const v = await this.secrets.get(key);
    if (!v) throw new InternalServerErrorException(`Missing payment credential: ${key}`);
    return v;
  }

  async isConfigured(): Promise<boolean> {
    return (await this.secrets.isSet('DPO_COMPANY_TOKEN')) && (await this.secrets.isSet('DPO_SERVICE_TYPE'));
  }

  private async apiUrl(): Promise<string> {
    return (await this.secrets.get('DPO_API_URL')) || 'https://secure.3gdirectpay.com/API/v6/';
  }

  private get payBase(): string {
    return this.config.get<string>('DPO_PAY_URL') ?? 'https://secure.3gdirectpay.com/payv2.php';
  }

  async currency(): Promise<string> {
    return (await this.secrets.get('DPO_CURRENCY')) || 'UGX';
  }

  private tag(xml: string, name: string): string | undefined {
    const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
    return m?.[1]?.trim();
  }

  private async post(xml: string): Promise<string> {
    const res = await fetch(await this.apiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml', Accept: 'application/xml' },
      body: xml,
    });
    const text = await res.text();
    if (!res.ok) throw new InternalServerErrorException(`DPO API HTTP ${res.status}: ${text.slice(0, 300)}`);
    return text;
  }

  /**
   * Create a transaction token and return the hosted payment-page URL the
   * customer (web) or in-app browser (mobile) opens to pay.
   */
  async createCheckout(params: {
    amountUgx: number;
    companyRef: string;
    redirectUrl: string;
    backUrl: string;
    phone?: string;
    email?: string;
    description: string;
  }): Promise<{ token: string; paymentUrl: string }> {
    const companyToken = await this.cred('DPO_COMPANY_TOKEN');
    const serviceType = await this.cred('DPO_SERVICE_TYPE');
    const currency = await this.currency();
    const serviceDate = new Date().toISOString().slice(0, 10).replace(/-/g, '/'); // YYYY/MM/DD

    const xml =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<API3G>` +
      `<CompanyToken>${companyToken}</CompanyToken>` +
      `<Request>createToken</Request>` +
      `<Transaction>` +
      `<PaymentAmount>${params.amountUgx}</PaymentAmount>` +
      `<PaymentCurrency>${currency}</PaymentCurrency>` +
      `<CompanyRef>${this.escape(params.companyRef)}</CompanyRef>` +
      `<RedirectURL>${this.escape(params.redirectUrl)}</RedirectURL>` +
      `<BackURL>${this.escape(params.backUrl)}</BackURL>` +
      (params.email ? `<customerEmail>${this.escape(params.email)}</customerEmail>` : '') +
      (params.phone ? `<customerPhone>${this.escape(params.phone.replace(/^\+/, ''))}</customerPhone>` : '') +
      `</Transaction>` +
      `<Services><Service>` +
      `<ServiceType>${serviceType}</ServiceType>` +
      `<ServiceDescription>${this.escape(params.description)}</ServiceDescription>` +
      `<ServiceDate>${serviceDate}</ServiceDate>` +
      `</Service></Services>` +
      `</API3G>`;

    const resp = await this.post(xml);
    const result = this.tag(resp, 'Result');
    const token = this.tag(resp, 'TransToken');
    if (result !== '000' || !token) {
      const explanation = this.tag(resp, 'ResultExplanation') ?? `Result ${result}`;
      throw new InternalServerErrorException(`DPO createToken failed: ${explanation}`);
    }
    return { token, paymentUrl: `${this.payBase}?ID=${encodeURIComponent(token)}` };
  }

  /** Verify a transaction token: SUCCESSFUL | PENDING | FAILED. */
  async verifyToken(token: string): Promise<{ status: 'PENDING' | 'SUCCESSFUL' | 'FAILED' }> {
    const companyToken = await this.cred('DPO_COMPANY_TOKEN');
    const xml =
      `<?xml version="1.0" encoding="utf-8"?>` +
      `<API3G>` +
      `<CompanyToken>${companyToken}</CompanyToken>` +
      `<Request>verifyToken</Request>` +
      `<TransactionToken>${this.escape(token)}</TransactionToken>` +
      `</API3G>`;

    const resp = await this.post(xml);
    const result = this.tag(resp, 'Result');
    // 000 = paid; 900 = not paid yet (pending); anything else = failed/declined.
    if (result === '000') return { status: 'SUCCESSFUL' };
    if (result === '900') return { status: 'PENDING' };
    return { status: 'FAILED' };
  }

  private escape(s: string): string {
    return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
  }
}
