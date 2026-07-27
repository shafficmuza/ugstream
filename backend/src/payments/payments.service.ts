import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { FlutterwaveService } from './flutterwave.service';
import { StripeService } from './stripe.service';
import { MomoService } from './momo.service';
import { YoService } from './yo.service';
import { DpoService } from './dpo.service';
import { SecretsService } from '../common/secrets.service';

/** Concrete payment processors. Card → stripe; the rest are mobile-money. */
export type PaymentProvider = 'flutterwave' | 'stripe' | 'momo' | 'yo' | 'dpo';
const MOBILE_MONEY_PROVIDERS: PaymentProvider[] = ['momo', 'flutterwave', 'yo', 'dpo'];

export interface CheckoutDto {
  purpose: 'subscription' | 'title';
  planId?: number;
  titleId?: string;
  // Preferred (mobile-app friendly): the app just asks for 'card' or
  // 'mobile_money' and the backend routes to the configured processor.
  method?: 'card' | 'mobile_money';
  // Back-compat / override: an explicit concrete processor.
  provider?: PaymentProvider;
  // Mobile-money number to charge — lets the customer pay from a different
  // line than the one they logged in with. Falls back to the login number.
  payerPhone?: string;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flutterwave: FlutterwaveService,
    private readonly stripe: StripeService,
    private readonly momo: MomoService,
    private readonly yo: YoService,
    private readonly dpo: DpoService,
    private readonly secrets: SecretsService,
    private readonly config: ConfigService,
  ) {}

  /** The mobile-money processor an admin has activated (defaults to momo). */
  private async activeMobileMoneyProvider(): Promise<PaymentProvider> {
    const settings = await this.prisma.appSettings.findUnique({ where: { id: 1 } });
    const p = settings?.mobileMoneyProvider as PaymentProvider | undefined;
    return p && MOBILE_MONEY_PROVIDERS.includes(p) ? p : 'momo';
  }

  /**
   * Resolve the concrete processor for a checkout: 'card' → Stripe,
   * 'mobile_money' → the admin-selected provider. An explicit `provider`
   * still wins (back-compat), else default to the active mobile-money one.
   */
  private async resolveProvider(dto: CheckoutDto): Promise<PaymentProvider> {
    if (dto.method === 'card') return 'stripe';
    if (dto.method === 'mobile_money') return this.activeMobileMoneyProvider();
    if (dto.provider) return dto.provider;
    return this.activeMobileMoneyProvider();
  }

  /** What the app/web should render as available payment options. */
  async paymentMethods() {
    const mm = await this.activeMobileMoneyProvider();
    const configured: Record<PaymentProvider, boolean> = {
      stripe: Boolean(this.config.get('STRIPE_SECRET_KEY')),
      flutterwave: await this.secrets.isSet('FLUTTERWAVE_SECRET_KEY'),
      momo: await this.secrets.isSet('MOMO_API_USER'),
      yo: await this.yo.isConfigured(),
      dpo: await this.dpo.isConfigured(),
    };
    return {
      methods: [
        { method: 'card', provider: 'stripe', enabled: configured.stripe },
        { method: 'mobile_money', provider: mm, enabled: configured[mm], label: this.providerLabel(mm) },
      ],
    };
  }

  private providerLabel(p: PaymentProvider): string {
    return { momo: 'MTN Mobile Money', flutterwave: 'Flutterwave', yo: 'Yo! Payments', dpo: 'DPO Pay', stripe: 'Card' }[p];
  }

  /** Normalise a Ugandan mobile-money number to 256XXXXXXXXX (no '+'). */
  private normalizeUgPhone(input: string): string {
    let n = input.replace(/[^\d]/g, '');
    if (n.startsWith('0')) n = '256' + n.slice(1);
    else if (n.length === 9) n = '256' + n; // e.g. 772123456
    if (!/^256\d{9}$/.test(n)) {
      throw new BadRequestException('Enter a valid Ugandan mobile money number, e.g. 0772123456.');
    }
    return n;
  }

  async checkout(userId: bigint, dto: CheckoutDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const provider = await this.resolveProvider(dto);
    // The number to charge for mobile money: the customer-entered one if
    // given, else the account's login number.
    const payerPhone = dto.payerPhone ? this.normalizeUgPhone(dto.payerPhone) : user.phone;

    let amountUgx: number;
    let planId: number | undefined;
    let titleId: bigint | undefined;
    let description: string;

    if (dto.purpose === 'subscription') {
      if (!dto.planId) throw new BadRequestException('planId is required.');
      const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
      if (!plan || !plan.active) throw new NotFoundException('Plan not found.');
      amountUgx = plan.priceUgx;
      planId = plan.id;
      description = `${plan.name} subscription`;
    } else {
      if (!dto.titleId) throw new BadRequestException('titleId is required.');
      const title = await this.prisma.title.findUnique({ where: { id: BigInt(dto.titleId) } });
      if (!title || !title.priceUgx) throw new NotFoundException('Title is not available for purchase.');
      amountUgx = title.priceUgx;
      titleId = title.id;
      description = title.name;
    }

    const txRef = `ugs_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

    const payment = await this.prisma.payment.create({
      data: {
        userId,
        amountUgx,
        purpose: dto.purpose,
        planId,
        titleId,
        provider,
        providerRef: txRef,
        status: 'pending',
      },
    });

    if (provider === 'stripe') {
      const redirectBase = this.config.get<string>('PAYMENTS_REDIRECT_URL')!;
      const { url, sessionId } = await this.stripe.createCheckoutSession({
        txRef,
        amountUsdCents: this.ugxToUsdCents(amountUgx),
        description,
        successUrl: `${redirectBase}?status=success&tx_ref=${txRef}`,
        cancelUrl: `${redirectBase}?status=cancelled&tx_ref=${txRef}`,
      });
      // Stashed now (while still 'pending') so getStatus() can self-heal by
      // asking Stripe directly if the webhook never arrives — see the
      // 2026-07-22 incident notes in grantEntitlement's neighbor,
      // confirmStripeSession, and deploy/README.md bug #10.
      await this.prisma.payment.update({ where: { id: payment.id }, data: { providerTxId: sessionId } });
      return {
        paymentId: payment.id.toString(),
        provider,
        checkoutUrl: url,
        action: { type: 'redirect' as const, url },
      };
    }

    if (provider === 'momo') {
      // No hosted page — MTN pushes an approval prompt straight to the
      // customer's phone. amountUgx is sent as-is; in sandbox MTN requires
      // EUR (test amounts, not a real conversion), production uses UGX.
      const { referenceId } = await this.momo.requestToPay({
        amount: amountUgx,
        msisdn: payerPhone,
        externalId: txRef,
        payerMessage: description,
        payeeNote: 'ugstream',
      });
      await this.prisma.payment.update({ where: { id: payment.id }, data: { providerTxId: referenceId } });
      return {
        paymentId: payment.id.toString(),
        provider,
        checkoutUrl: null,
        requiresPhoneApproval: true,
        action: { type: 'phone_prompt' as const },
      };
    }

    if (provider === 'yo') {
      // Yo! Payments deposit — an approval prompt goes to the phone, then we
      // poll (same shape as MTN MoMo).
      const { transactionRef } = await this.yo.requestPayment({
        amount: amountUgx,
        msisdn: payerPhone,
        narrative: description,
        externalRef: txRef,
      });
      await this.prisma.payment.update({ where: { id: payment.id }, data: { providerTxId: transactionRef } });
      return {
        paymentId: payment.id.toString(),
        provider,
        checkoutUrl: null,
        requiresPhoneApproval: true,
        action: { type: 'phone_prompt' as const },
      };
    }

    if (provider === 'dpo') {
      // DPO Pay — hosted payment page (like Flutterwave/Stripe); confirmed by
      // verifyToken on status poll.
      const redirectBase = this.config.get<string>('PAYMENTS_REDIRECT_URL')!;
      const { token, paymentUrl } = await this.dpo.createCheckout({
        amountUgx,
        companyRef: txRef,
        redirectUrl: `${redirectBase}?status=success&tx_ref=${txRef}`,
        backUrl: `${redirectBase}?status=cancelled&tx_ref=${txRef}`,
        phone: payerPhone,
        description,
      });
      await this.prisma.payment.update({ where: { id: payment.id }, data: { providerTxId: token } });
      return {
        paymentId: payment.id.toString(),
        provider,
        checkoutUrl: paymentUrl,
        action: { type: 'redirect' as const, url: paymentUrl },
      };
    }

    const { link } = await this.flutterwave.createCheckout({
      txRef,
      amountUgx,
      phone: payerPhone,
      customerName: user.displayName ?? undefined,
      redirectUrl: this.config.get('PAYMENTS_REDIRECT_URL')!,
    });

    return {
      paymentId: payment.id.toString(),
      provider,
      checkoutUrl: link,
      action: { type: 'redirect' as const, url: link },
    };
  }

  async getStatus(userId: bigint, paymentId: bigint) {
    let payment = await this.prisma.payment.findFirst({ where: { id: paymentId, userId } });
    if (!payment) throw new NotFoundException('Payment not found.');

    // Self-heal: an incident on 2026-07-22 charged a customer for real
    // while STRIPE_WEBHOOK_SECRET was still unset, so the webhook rejected
    // every delivery attempt and the payment sat 'pending' forever despite
    // Stripe showing 'paid'. Rather than depend solely on the webhook
    // arriving, check directly with Stripe on every status poll — the
    // frontend already polls this endpoint every 2s after checkout.
    if (payment.provider === 'stripe' && payment.status === 'pending' && payment.providerTxId) {
      const session = await this.stripe.retrieveSession(payment.providerTxId).catch(() => null);
      if (session?.paid) {
        await this.confirmStripeSession(payment.providerRef!, payment.providerTxId, session.amountTotal, session.currency);
        payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      }
    }

    // MTN MoMo has no signed-webhook equivalent to verify here, so polling
    // this endpoint (already done every 2s by the frontend while the "check
    // your phone" screen is up) *is* the primary confirmation path, not a
    // fallback for a missed webhook.
    if (payment.provider === 'momo' && payment.status === 'pending' && payment.providerTxId) {
      const result = await this.momo.getStatus(payment.providerTxId).catch(() => null);
      if (result?.status === 'SUCCESSFUL') {
        await this.grantEntitlement(payment.id, payment.providerTxId);
        payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      } else if (result?.status === 'FAILED') {
        await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'failed' } });
        payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      }
    }

    // Yo! Payments — no signed webhook, so polling here is the confirmation
    // path (same pattern as MoMo).
    if (payment.provider === 'yo' && payment.status === 'pending' && payment.providerTxId) {
      const result = await this.yo.getStatus(payment.providerTxId).catch(() => null);
      if (result?.status === 'SUCCESSFUL') {
        await this.grantEntitlement(payment.id, payment.providerTxId);
        payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      } else if (result?.status === 'FAILED') {
        await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'failed' } });
        payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      }
    }

    // DPO Pay — confirm by verifying the transaction token directly.
    if (payment.provider === 'dpo' && payment.status === 'pending' && payment.providerTxId) {
      const result = await this.dpo.verifyToken(payment.providerTxId).catch(() => null);
      if (result?.status === 'SUCCESSFUL') {
        await this.grantEntitlement(payment.id, payment.providerTxId);
        payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      } else if (result?.status === 'FAILED') {
        await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'failed' } });
        payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
      }
    }

    return {
      ...payment,
      id: payment.id.toString(),
      userId: payment.userId.toString(),
      titleId: payment.titleId?.toString() ?? null,
    };
  }

  /**
   * Called from the Flutterwave webhook after signature verification.
   * Re-verifies the transaction with Flutterwave directly (never trusts
   * the webhook body), then grants the entitlement — idempotent on
   * payment.status already being 'successful'.
   */
  async confirmFromWebhook(transactionId: string, txRef: string) {
    const verified = await this.flutterwave.verifyTransaction(transactionId);
    if (verified.txRef !== txRef) {
      throw new BadRequestException('tx_ref mismatch between webhook and verified transaction.');
    }

    const payment = await this.prisma.payment.findUnique({ where: { providerRef: txRef } });
    if (!payment) throw new NotFoundException('Payment not found for tx_ref.');
    if (payment.status === 'successful') return; // already processed — idempotent

    if (verified.status !== 'successful' || verified.currency !== 'UGX' || verified.amount < payment.amountUgx) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'failed', providerTxId: transactionId },
      });
      return;
    }

    await this.grantEntitlement(payment.id, transactionId);
  }

  /**
   * Called from the Yo! Payments IPN. The notification only tells us which
   * transaction changed; we re-verify the real status with Yo directly
   * (never trust the IPN body) before granting. Idempotent.
   */
  async confirmYoIpn(externalRef?: string, yoTxRef?: string): Promise<void> {
    if (!externalRef && !yoTxRef) return;
    const payment = externalRef
      ? await this.prisma.payment.findUnique({ where: { providerRef: externalRef } })
      : await this.prisma.payment.findFirst({ where: { providerTxId: yoTxRef } });
    if (!payment || payment.provider !== 'yo') return;
    if (payment.status === 'successful') return; // already processed — idempotent

    const ref = payment.providerTxId ?? yoTxRef;
    if (!ref) return;
    const result = await this.yo.getStatus(ref).catch(() => null);
    if (result?.status === 'SUCCESSFUL') {
      await this.grantEntitlement(payment.id, ref);
    } else if (result?.status === 'FAILED') {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'failed' } });
    }
  }

  /**
   * Called from the Stripe webhook after signature verification (Stripe's
   * SDK already confirms the event is genuinely from Stripe, so unlike
   * Flutterwave there's no separate "re-verify with the provider" round
   * trip needed — the constructEvent() call *is* the verification).
   */
  async confirmStripeSession(txRef: string, stripeSessionId: string, amountTotal: number, currency: string) {
    const payment = await this.prisma.payment.findUnique({ where: { providerRef: txRef } });
    if (!payment) throw new NotFoundException('Payment not found for tx_ref.');
    if (payment.status === 'successful') return; // already processed — idempotent

    // Re-derive the expected charge the same way checkout() did, rather
    // than storing a separate USD amount on the payment row — the
    // exchange rate is a slow-moving config value, not a live-fluctuating
    // one, so recomputing is safe and avoids a schema change for a
    // Stripe-only field.
    const expectedUsdCents = this.ugxToUsdCents(payment.amountUgx);
    if (currency.toLowerCase() !== 'usd' || amountTotal < expectedUsdCents) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'failed', providerTxId: stripeSessionId },
      });
      return;
    }

    await this.grantEntitlement(payment.id, stripeSessionId);
  }

  /**
   * Stripe's Checkout doesn't reliably treat UGX as zero-decimal for this
   * account (empirically: unit_amount 8000 + currency 'ugx' was read back
   * as 80.00 UGX, ~$0.02 — under Stripe's ~$0.50 minimum). Charging in USD
   * sidesteps that entirely. STRIPE_UGX_PER_USD is a plain config value
   * (not a live FX feed) — update it in backend/.env as rates drift.
   */
  private ugxToUsdCents(amountUgx: number): number {
    const rate = Number(this.config.get('STRIPE_UGX_PER_USD') ?? 3800);
    return Math.max(50, Math.round((amountUgx / rate) * 100));
  }

  private async grantEntitlement(paymentId: bigint, providerTxId: string) {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'successful', providerTxId, confirmedAt: new Date() },
      });

      if (payment.purpose === 'subscription' && payment.planId) {
        const plan = await tx.plan.findUniqueOrThrow({ where: { id: payment.planId } });
        const startsAt = new Date();
        const expiresAt = new Date(startsAt.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);
        await tx.subscription.create({
          data: { userId: payment.userId, planId: plan.id, paymentId: payment.id, startsAt, expiresAt },
        });
      } else if (payment.purpose === 'title' && payment.titleId) {
        const title = await tx.title.findUniqueOrThrow({ where: { id: payment.titleId } });
        const expiresAt = new Date(Date.now() + title.rentalHours * 60 * 60 * 1000);
        await tx.purchase.create({
          data: { userId: payment.userId, titleId: title.id, paymentId: payment.id, expiresAt },
        });
      }
    });
  }
}
