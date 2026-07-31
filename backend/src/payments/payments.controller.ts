import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator';
import { CheckoutDto } from './dto/checkout.dto';

@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Payment options the app/web should show (card + active mobile money). */
  @Get('methods')
  methods() {
    return this.payments.paymentMethods();
  }

  @Post('checkout')
  checkout(@CurrentUser() auth: AuthContext, @Body() body: CheckoutDto) {
    return this.payments.checkout(auth.userId, body);
  }

  @Get(':id')
  status(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return this.payments.getStatus(auth.userId, BigInt(id));
  }
}
