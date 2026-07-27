import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { AdminPaymentsController } from './admin-payments.controller';
import { PaymentsService } from './payments.service';
import { FlutterwaveService } from './flutterwave.service';
import { StripeService } from './stripe.service';
import { MomoService } from './momo.service';
import { YoService } from './yo.service';
import { DpoService } from './dpo.service';

@Module({
  controllers: [PaymentsController, AdminPaymentsController],
  providers: [PaymentsService, FlutterwaveService, StripeService, MomoService, YoService, DpoService],
  exports: [PaymentsService, FlutterwaveService, StripeService, MomoService, YoService, DpoService],
})
export class PaymentsModule {}
