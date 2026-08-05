import { Controller, Get, Param } from '@nestjs/common';
import { PaymentsService } from './payments.service';

/**
 * Unauthenticated payment status lookup.
 *
 * A hosted checkout (Stripe/DPO) redirects the customer's *browser* back to
 * us, and that browser has no session — particularly when the payment was
 * started from the mobile app. Without this the callback page could never
 * confirm the result and sat on "waiting for confirmation" forever.
 *
 * Kept in its own controller because PaymentsController guards every route
 * with JwtAuthGuard at class level. Only the status string is returned, and
 * the reference is an opaque random token, so nothing sensitive is exposed.
 */
@Controller('payments')
export class PublicPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('by-ref/:txRef')
  statusByRef(@Param('txRef') txRef: string) {
    return this.payments.statusByRef(txRef);
  }
}
