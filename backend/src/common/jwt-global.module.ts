import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

/**
 * JwtAuthGuard is applied via @UseGuards() across many feature modules
 * (genres, episodes, titles, payments...), and Nest resolves a guard's
 * constructor deps from the module it's *used* in — not from wherever
 * JwtModule happens to be imported. Making it global here means every
 * module can construct JwtAuthGuard without importing JwtModule itself.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  exports: [JwtModule],
})
export class JwtGlobalModule {}
