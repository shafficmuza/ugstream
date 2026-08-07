import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { MeController } from './me.controller';
import { AuthService } from './auth.service';
import { SmsService } from './sms.service';
import { MasterCodeService } from './master-code.service';
import { DevBypassService } from './dev-bypass.service';
import { PinService } from './pin.service';

@Module({
  controllers: [AuthController, MeController],
  providers: [AuthService, SmsService, MasterCodeService, DevBypassService, PinService],
  exports: [AuthService, MasterCodeService, DevBypassService, PinService],
})
export class AuthModule {}
