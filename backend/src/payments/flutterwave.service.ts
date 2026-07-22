import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * Flutterwave Standard checkout. Docs:
 * https://developer.flutterwave.com/docs/collecting-payments/standard
 */
@Injectable()
export class FlutterwaveService {
  constructor(private readonly config: ConfigService) {}

  private mustGet(key: string): string {
    const value = this.config.get<string>(key);
    if (!value) throw new InternalServerErrorException(`Missing config: ${key}`);
    return value;
  }

  async createCheckout(params: {
    txRef: string;
    amountUgx: number;
    phone: string;
    customerName?: string;
    redirectUrl: string;
  }): Promise<{ link: string }> {
    const res = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.mustGet('FLUTTERWAVE_SECRET_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tx_ref: params.txRef,
        amount: params.amountUgx,
        currency: 'UGX',
        redirect_url: params.redirectUrl,
        customer: { phonenumber: params.phone, name: params.customerName ?? params.phone },
        payment_options: 'mobilemoneyuganda,card',
        customizations: { title: 'ugstream' },
      }),
    });

    const json = await res.json();
    if (json.status !== 'success') {
      throw new InternalServerErrorException(`Flutterwave checkout failed: ${JSON.stringify(json)}`);
    }
    return { link: json.data.link };
  }

  /** Re-fetches the transaction from Flutterwave — never trust webhook body alone. */
  async verifyTransaction(transactionId: string): Promise<{
    status: string;
    amount: number;
    currency: string;
    txRef: string;
  }> {
    const res = await fetch(
      `https://api.flutterwave.com/v3/transactions/${transactionId}/verify`,
      { headers: { Authorization: `Bearer ${this.mustGet('FLUTTERWAVE_SECRET_KEY')}` } },
    );
    const json = await res.json();
    if (json.status !== 'success') {
      throw new InternalServerErrorException(`Flutterwave verify failed: ${JSON.stringify(json)}`);
    }
    return {
      status: json.data.status,
      amount: json.data.amount,
      currency: json.data.currency,
      txRef: json.data.tx_ref,
    };
  }

  /** Flutterwave sends a `verif-hash` header equal to your configured secret hash. */
  verifyWebhookSignature(signatureHeader: string | undefined): boolean {
    const expected = this.mustGet('FLUTTERWAVE_WEBHOOK_SECRET_HASH');
    if (!signatureHeader || signatureHeader.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  }
}
