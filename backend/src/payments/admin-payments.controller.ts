import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { SecretsService } from '../common/secrets.service';

// Whitelisted credential keys per mobile-money provider — the only keys the
// UI can write, so the credentials form can't be used to set arbitrary
// secrets. Card (Stripe) credentials stay in env by design.
const PROVIDER_KEYS: Record<string, string[]> = {
  momo: ['MOMO_API_USER', 'MOMO_API_KEY', 'MOMO_SUBSCRIPTION_KEY'],
  flutterwave: ['FLUTTERWAVE_SECRET_KEY', 'FLUTTERWAVE_WEBHOOK_SECRET_HASH'],
  yo: ['YO_API_USERNAME', 'YO_API_PASSWORD', 'YO_API_URL', 'YO_IPN_URL'],
  dpo: ['DPO_COMPANY_TOKEN', 'DPO_SERVICE_TYPE', 'DPO_CURRENCY', 'DPO_API_URL'],
};
const ALL_KEYS = Object.values(PROVIDER_KEYS).flat();

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
  ) {}

  /** Per-provider credential fields + whether each is currently set (no values). */
  @Get('credentials')
  async credentials() {
    const status = await this.secrets.status(ALL_KEYS);
    return {
      providers: Object.entries(PROVIDER_KEYS).map(([provider, keys]) => ({
        provider,
        keys: keys.map((key) => ({ key, set: status[key] })),
      })),
    };
  }

  /** Set/clear credential values (empty string clears). Whitelisted keys only. */
  @Post('credentials')
  async setCredentials(@Body() body: { values: Record<string, string> }) {
    const values = body?.values ?? {};
    const keys = Object.keys(values);
    const invalid = keys.filter((k) => !ALL_KEYS.includes(k));
    if (invalid.length) throw new BadRequestException(`Unknown credential key(s): ${invalid.join(', ')}`);
    for (const k of keys) await this.secrets.set(k, values[k]);
    return { ok: true, updated: keys.length };
  }

  @Get()
  async list(@Query('page') page?: string, @Query('per_page') perPage?: string) {
    const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const perPageNum = Math.min(100, Math.max(1, parseInt(perPage ?? '30', 10) || 30));

    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * perPageNum,
        take: perPageNum,
        include: { user: { select: { phone: true } }, plan: { select: { name: true } } },
      }),
      this.prisma.payment.count(),
    ]);

    return {
      items: items.map((p) => ({
        id: p.id.toString(),
        userPhone: p.user.phone,
        amountUgx: p.amountUgx,
        purpose: p.purpose,
        planName: p.plan?.name ?? null,
        titleId: p.titleId?.toString() ?? null,
        provider: p.provider,
        status: p.status,
        createdAt: p.createdAt,
        confirmedAt: p.confirmedAt,
      })),
      page: pageNum,
      perPage: perPageNum,
      total,
      totalPages: Math.ceil(total / perPageNum),
    };
  }
}
