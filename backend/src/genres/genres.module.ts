import { Module } from '@nestjs/common';
import { GenresController } from './genres.controller';

@Module({ controllers: [GenresController] })
export class GenresModule {}
