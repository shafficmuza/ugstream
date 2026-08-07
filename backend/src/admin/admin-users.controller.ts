import { Body, Controller, Get, Logger, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator';
import { ActivityService } from '../common/activity.service';
import { UpdateUserDto } from './dto/update-user.dto';

/** Long enough to read a code down a phone line, short enough to be useless later. */
const RECOVERY_CODE_TTL_MINUTES = 15;

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/users')
export class AdminUsersController {
  private readonly logger = new Logger(AdminUsersController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  @Get()
  async list(@Query('page') page?: string, @Query('per_page') perPage?: string, @Query('q') q?: string) {
    const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const perPageNum = Math.min(100, Math.max(1, parseInt(perPage ?? '30', 10) || 30));
    const where = q ? { phone: { contains: q } } : {};

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * perPageNum,
        take: perPageNum,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: items.map((u) => ({ ...u, id: u.id.toString() })),
      page: pageNum,
      perPage: perPageNum,
      total,
      totalPages: Math.ceil(total / perPageNum),
    };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateUserDto,
  ) {
    const user = await this.prisma.user.update({ where: { id: BigInt(id) }, data: body });
    return { ...user, id: user.id.toString() };
  }

  /**
   * Issue a one-off sign-in code for a user who cannot receive SMS — a lost
   * handset, a changed number, a carrier not delivering. Support reads the
   * code out, the user enters it on the normal sign-in screen, and it stops
   * working immediately afterwards.
   *
   * Deliberately not a master code. A single fixed value that opens any
   * account is one screenshot or one departing employee away from total
   * compromise, cannot be revoked without a deploy, and leaves nothing in the
   * logs to say who used it or on whom. This does the same job for support
   * while being:
   *
   *   - bound to one phone number, so it opens exactly one account;
   *   - single use, since verifyOtp consumes the row it matches;
   *   - expiring in minutes rather than living forever;
   *   - attributable — every issue is written to the activity log against the
   *     admin who asked for it.
   *
   * It reuses the ordinary otp_codes table rather than introducing a second
   * way to authenticate, so there is no separate bypass path that could drift
   * out of step with the real one.
   */
  @Post(':id/recovery-code')
  async issueRecoveryCode(@Param('id') id: string, @CurrentUser() admin: AuthContext) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: BigInt(id) } });

    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + RECOVERY_CODE_TTL_MINUTES * 60 * 1000);

    // Any code already outstanding for this number is retired first, so a
    // second call cannot leave two working codes behind.
    await this.prisma.otpCode.updateMany({
      where: { phone: user.phone, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    await this.prisma.otpCode.create({
      data: {
        phone: user.phone,
        codeHash: await bcrypt.hash(code, 10),
        expiresAt,
        issuedByAdminId: admin.userId,
      },
    });

    this.activity.log(
      admin.userId,
      'recovery_code_issued',
      `Issued a sign-in recovery code for ${user.phone}`,
    );
    this.logger.warn(
      `Admin ${admin.userId} issued a recovery code for ${user.phone} (expires ${expiresAt.toISOString()})`,
    );

    return { code, expiresAt, expiresInMinutes: RECOVERY_CODE_TTL_MINUTES, phone: user.phone };
  }
}
