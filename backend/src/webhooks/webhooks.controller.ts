import { BadRequestException, Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PaymentsService } from '../payments/payments.service';
import { FlutterwaveService } from '../payments/flutterwave.service';
import { StripeService } from '../payments/stripe.service';
import { EpisodesService } from '../episodes/episodes.service';

interface RawBodyRequest {
  rawBody: Buffer;
}

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly flutterwave: FlutterwaveService,
    private readonly stripe: StripeService,
    private readonly episodes: EpisodesService,
    private readonly config: ConfigService,
  ) {}

  @Post('flutterwave')
  async flutterwaveWebhook(
    @Headers('verif-hash') verifHash: string | undefined,
    @Body() body: any,
  ) {
    if (!(await this.flutterwave.verifyWebhookSignature(verifHash))) {
      throw new BadRequestException('Invalid webhook signature.');
    }

    // We only trust this payload enough to know *which* transaction to look
    // up — confirmFromWebhook re-fetches the real status from Flutterwave.
    const transactionId = body?.data?.id;
    const txRef = body?.data?.tx_ref;
    if (!transactionId || !txRef) {
      throw new BadRequestException('Missing transaction id or tx_ref.');
    }

    await this.payments.confirmFromWebhook(String(transactionId), String(txRef));
    return { ok: true };
  }

  /**
   * Stripe webhook — configured in Stripe Dashboard > Developers >
   * Webhooks, pointed at /v1/webhooks/stripe. Unlike Flutterwave, Stripe's
   * SDK signature check (constructEvent) *is* the verification — no
   * separate "re-fetch from the provider" round trip needed, since a
   * valid signature already proves the payload is genuinely from Stripe.
   */
  @Post('stripe')
  async stripeWebhook(
    @Headers('stripe-signature') signature: string | undefined,
    @Req() req: RawBodyRequest,
  ) {
    if (!signature) throw new BadRequestException('Missing stripe-signature header.');

    let event;
    try {
      event = this.stripe.constructWebhookEvent(req.rawBody, signature);
    } catch {
      throw new BadRequestException('Invalid webhook signature.');
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as { client_reference_id: string | null; id: string; amount_total: number | null; currency: string | null };
      if (session.client_reference_id && session.amount_total != null && session.currency) {
        await this.payments.confirmStripeSession(
          session.client_reference_id,
          session.id,
          session.amount_total,
          session.currency,
        );
      }
    }

    return { ok: true };
  }

  /**
   * Cloudflare Stream webhook — configured in the dashboard under
   * Stream > Webhooks. Fires when transcoding finishes or fails.
   * https://developers.cloudflare.com/stream/manage-video-library/using-webhooks/
   */
  @Post('cloudflare-stream')
  async cloudflareStreamWebhook(
    @Headers('webhook-signature') signatureHeader: string | undefined,
    @Body() body: any,
    @Req() req: RawBodyRequest,
  ) {
    this.verifyCloudflareSignature(signatureHeader, req.rawBody);

    const uid = body?.uid;
    const readyToStream = body?.readyToStream;
    const status = body?.status?.state;

    if (!uid) throw new BadRequestException('Missing video uid.');

    if (readyToStream || status === 'ready') {
      await this.episodes.markReady(
        uid,
        Math.round(body?.duration ?? 0),
        body?.thumbnail ?? '',
      );
    } else if (status === 'error') {
      await this.episodes.markError(uid);
    }

    return { ok: true };
  }

  /**
   * Cloudflare sends `Webhook-Signature: time=<unix>,sig1=<hex hmac>` where
   * sig1 = HMAC_SHA256(secret, `${time}.${rawBody}`). Secret is shown once
   * when you create the webhook in the Stream dashboard.
   */
  private verifyCloudflareSignature(header: string | undefined, rawBody: Buffer) {
    const secret = this.config.get<string>('CLOUDFLARE_STREAM_WEBHOOK_SECRET');
    if (!secret) throw new BadRequestException('Webhook secret not configured.');
    if (!header) throw new BadRequestException('Missing webhook signature.');

    const parts = Object.fromEntries(
      header.split(',').map((kv) => kv.split('=') as [string, string]),
    );
    const { time, sig1 } = parts;
    if (!time || !sig1) throw new BadRequestException('Malformed webhook signature.');

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${time}.${rawBody.toString('utf8')}`)
      .digest('hex');

    if (expected.length !== sig1.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig1))) {
      throw new BadRequestException('Invalid webhook signature.');
    }
  }
}
