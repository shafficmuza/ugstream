import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateGenreDto } from './dto/genre.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { StaffGuard } from '../common/guards/staff.guard';

@Controller()
export class GenresController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('genres')
  list() {
    return this.prisma.genre.findMany({ orderBy: { name: 'asc' } });
  }

  @UseGuards(JwtAuthGuard, StaffGuard)
  @Get('admin/genres')
  async adminList() {
    const genres = await this.prisma.genre.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { titles: true } } },
    });
    return genres.map((g) => ({ ...g, titleCount: g._count.titles, _count: undefined }));
  }

  @UseGuards(JwtAuthGuard, StaffGuard)
  @Post('admin/genres')
  create(@Body() body: CreateGenreDto) {
    return this.prisma.genre.create({ data: body });
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete('admin/genres/:id')
  async remove(@Param('id') id: string) {
    await this.prisma.genre.delete({ where: { id: Number(id) } });
    return { ok: true };
  }
}
