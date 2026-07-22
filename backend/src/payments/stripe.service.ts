import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * Card payments via Stripe Checkout (hosted page — Stripe holds the card
 * form, so this app never touches card numbers / PCI scope). Runs
 * alongside Flutterwave, which stays the path for MTN/Airtel Mobile Money.
 *
 * Charges in USD, not UGX. UGX is NOT treated as zero-decimal by this
 * Stripe account in practice — empirically, passing unit_amount: 8000
 * with currency: 'ugx' was interpreted as 80.00 UGX (≈$0.02), well under
 * Stripe's ~$0.50 minimum charge. Rather than fight that, this service
 * takes an already-converted USD amount — see PaymentsService for the
 * UGX->USD conversion (kept there, not here, since it owns amountUgx).
 */
@Injectable()
export class StripeService {
  private client: Stripe | null = null;

  constructor(private readonly config: ConfigService) {}

  private getClient(): Stripe {
    if (this.client) return this.client;
    const secretKey = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!secretKey) throw new InternalServerErrorException('Missing config: STRIPE_SECRET_KEY');
    this.client = new Stripe(secretKey);
    return this.client;
  }

  async createCheckoutSession(params: {
    txRef: string;
    amountUsdCents: number;
    description: string;
    customerEmail?: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string; sessionId: string }> {
    const session = await this.getClient().checkout.sessions.create({
      mode: 'payment',
      client_reference_id: params.txRef,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: params.amountUsdCents,
            product_data: { name: params.description },
          },
          quantity: 1,
        },
      ],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      customer_email: params.customerEmail,
    });

    if (!session.url) throw new InternalServerErrorException('Stripe did not return a checkout URL.');
    return { url: session.url, sessionId: session.id };
  }

  /**
   * Direct status check, independent of the webhook — a customer was once
   * charged for real (Stripe: `paid`) while our own record stayed
   * `pending` because STRIPE_WEBHOOK_SECRET wasn't configured yet, so the
   * webhook rejected every delivery. This lets PaymentsService.getStatus()
   * self-heal on each poll rather than depend on the webhook alone ever
   * arriving — defense in depth, matching how the Flutterwave webhook
   * already re-verifies with the provider instead of trusting its own
   * webhook body.
   */
  async retrieveSession(sessionId: string): Promise<{ paid: boolean; amountTotal: number; currency: string }> {
    const session = await this.getClient().checkout.sessions.retrieve(sessionId);
    return {
      paid: session.status === 'complete' && session.payment_status === 'paid',
      amountTotal: session.amount_total ?? 0,
      currency: session.currency ?? '',
    };
  }

  /** Verifies the webhook signature and returns the parsed event, or throws. */
  constructWebhookEvent(rawBody: Buffer, signatureHeader: string): Stripe.Event {
    const webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) throw new InternalServerErrorException('Missing config: STRIPE_WEBHOOK_SECRET');
    // Throws Stripe.errors.StripeSignatureVerificationError on a bad signature —
    // let it propagate; the webhook controller treats any throw as invalid.
    return this.getClient().webhooks.constructEvent(rawBody, signatureHeader, webhookSecret);
  }
}
