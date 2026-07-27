import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { SecretsService } from '../common/secrets.service';

/**
 * MTN Mobile Money Collections API (Request-to-Pay). Unlike Flutterwave/
 * Stripe, there's no hosted checkout page — this pushes an approval
 * prompt straight to the customer's phone (they enter their MoMo PIN),
 * and we poll for the result. Modeled directly on the working reference
 * implementation in the Sente POS app (sentepos/momo_lib.php), which
 * itself follows MTN's documented Collections flow: token exchange ->
 * requesttopay (202, async) -> poll status.
 *
 * MOMO_ENV=sandbox uses EUR test amounts per MTN's sandbox rules; UGX only
 * becomes available once MTN approves production credentials (a separate,
 * manual onboarding process — sandbox credentials can't be "upgraded").
 */
@Injectable()
export class MomoService {
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly secrets: SecretsService,
  ) {}

  // Credentials come from the admin-editable secrets store (DB → env).
  private async mustGet(key: string): Promise<string> {
    const value = await this.secrets.get(key);
    if (!value) throw new InternalServerErrorException(`Missing payment credential: ${key}`);
    return value;
  }

  private get env(): string {
    return this.config.get<string>('MOMO_ENV') ?? 'sandbox';
  }

  private get host(): string {
    return this.env === 'production'
      ? 'https://proxy.momoapi.mtn.com'
      : 'https://sandbox.momodeveloper.mtn.com';
  }

  get currency(): string {
    return this.env === 'production' ? 'UGX' : 'EUR';
  }

  private async getAccessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.token;
    }

    const apiUser = await this.mustGet('MOMO_API_USER');
    const apiKey = await this.mustGet('MOMO_API_KEY');
    const subscriptionKey = await this.mustGet('MOMO_SUBSCRIPTION_KEY');
    const basic = Buffer.from(`${apiUser}:${apiKey}`).toString('base64');

    const res = await fetch(`${this.host}/collection/token/`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Ocp-Apim-Subscription-Key': subscriptionKey,
        Accept: 'application/json',
      },
    });

    const json = await res.json();
    if (!res.ok || !json.access_token) {
      throw new InternalServerErrorException(`MoMo token request failed: ${JSON.stringify(json)}`);
    }

    // access_token TTL is returned in `expires_in` seconds — cache with a
    // 60s safety margin so we never use a token that expires mid-request.
    this.tokenCache = {
      token: json.access_token,
      expiresAt: Date.now() + (Number(json.expires_in ?? 3600) - 60) * 1000,
    };
    return json.access_token;
  }

  /**
   * Initiates a Request-to-Pay push to the customer's phone. Returns our
   * own referenceId (MTN's `X-Reference-Id`) — the *only* handle we get
   * back synchronously, since requesttopay itself returns 202 with no
   * body. Status must be polled separately via `getStatus`.
   */
  async requestToPay(params: {
    amount: number;
    msisdn: string;
    externalId: string;
    payerMessage: string;
    payeeNote: string;
  }): Promise<{ referenceId: string }> {
    const subscriptionKey = await this.mustGet('MOMO_SUBSCRIPTION_KEY');
    const token = await this.getAccessToken();
    const referenceId = crypto.randomUUID();

    // MSISDN must be digits only, no leading '+' — MTN's partyId format.
    const msisdn = params.msisdn.replace(/^\+/, '');

    const res = await fetch(`${this.host}/collection/v1_0/requesttopay`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Ocp-Apim-Subscription-Key': subscriptionKey,
        'X-Target-Environment': this.env,
        'X-Reference-Id': referenceId,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        amount: String(params.amount),
        currency: this.currency,
        externalId: params.externalId,
        payer: { partyIdType: 'MSISDN', partyId: msisdn },
        payerMessage: params.payerMessage,
        payeeNote: params.payeeNote,
      }),
    });

    if (res.status !== 202) {
      const body = await res.text();
      throw new InternalServerErrorException(`MoMo requesttopay failed (${res.status}): ${body}`);
    }

    return { referenceId };
  }

  /** Poll target for a pending Request-to-Pay: PENDING | SUCCESSFUL | FAILED. */
  async getStatus(referenceId: string): Promise<{ status: 'PENDING' | 'SUCCESSFUL' | 'FAILED'; amount?: string; currency?: string }> {
    const subscriptionKey = await this.mustGet('MOMO_SUBSCRIPTION_KEY');
    const token = await this.getAccessToken();

    const res = await fetch(
      `${this.host}/collection/v1_0/requesttopay/${encodeURIComponent(referenceId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Ocp-Apim-Subscription-Key': subscriptionKey,
          'X-Target-Environment': this.env,
          Accept: 'application/json',
        },
      },
    );

    const json = await res.json();
    if (!res.ok) {
      throw new InternalServerErrorException(`MoMo status check failed: ${JSON.stringify(json)}`);
    }
    return { status: json.status, amount: json.amount, currency: json.currency };
  }
}
