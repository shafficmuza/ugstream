import { Module } from '@nestjs/common';
import { KindsController } from './kinds.controller';

@Module({ controllers: [KindsController] })
export class KindsModule {}
