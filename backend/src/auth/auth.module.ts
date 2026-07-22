import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { MeController } from './me.controller';
import { AuthService } from './auth.service';
import { SmsService } from './sms.service';

@Module({
  controllers: [AuthController, MeController],
  providers: [AuthService, SmsService],
  exports: [AuthService],
})
export class AuthModule {}
