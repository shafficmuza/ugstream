import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { AdminPaymentsController } from './admin-payments.controller';
import { PaymentsService } from './payments.service';
import { FlutterwaveService } from './flutterwave.service';
import { StripeService } from './stripe.service';
import { MomoService } from './momo.service';

@Module({
  controllers: [PaymentsController, AdminPaymentsController],
  providers: [PaymentsService, FlutterwaveService, StripeService, MomoService],
  exports: [PaymentsService, FlutterwaveService, StripeService, MomoService],
})
export class PaymentsModule {}
