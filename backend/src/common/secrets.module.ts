import { Global, Module } from '@nestjs/common';
import { SecretsService } from './secrets.service';

// Global so payment services and the admin credentials controller can inject
// SecretsService anywhere without re-importing.
@Global()
@Module({
  providers: [SecretsService],
  exports: [SecretsService],
})
export class SecretsModule {}
