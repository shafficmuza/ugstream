import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('checkout')
  checkout(
    @CurrentUser() auth: AuthContext,
    @Body()
    body: {
      purpose: 'subscription' | 'title';
      planId?: number;
      titleId?: string;
      provider?: 'flutterwave' | 'stripe' | 'momo';
    },
  ) {
    return this.payments.checkout(auth.userId, body);
  }

  @Get(':id')
  status(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return this.payments.getStatus(auth.userId, BigInt(id));
  }
}
