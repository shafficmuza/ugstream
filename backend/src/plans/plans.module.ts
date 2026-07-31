import { Module } from '@nestjs/common';
import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { CreatePlanDto, UpdatePlanDto } from './dto/plan.dto';

@Controller('plans')
class PlansController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.plan.findMany({ where: { active: true }, orderBy: { priceUgx: 'asc' } });
  }
}

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/plans')
class AdminPlansController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.plan.findMany({ orderBy: { priceUgx: 'asc' } });
  }

  @Post()
  create(@Body() body: CreatePlanDto) {
    return this.prisma.plan.create({ data: body });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdatePlanDto) {
    return this.prisma.plan.update({ where: { id: Number(id) }, data: body });
  }
}

@Module({ controllers: [PlansController, AdminPlansController] })
export class PlansModule {}
