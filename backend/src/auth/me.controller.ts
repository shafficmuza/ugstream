import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('me')
  async me(@CurrentUser() auth: AuthContext) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });
    return this.toPublic(user);
  }

  /** Update own profile — name required, email/address optional. */
  @Patch('me')
  async update(@CurrentUser() auth: AuthContext, @Body() dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: auth.userId },
      data: {
        displayName: dto.displayName.trim(),
        // Empty strings clear the optional fields rather than storing "".
        email: dto.email?.trim() || null,
        address: dto.address?.trim() || null,
      },
    });
    return this.toPublic(user);
  }

  private toPublic(user: {
    id: bigint;
    phone: string;
    displayName: string | null;
    email: string | null;
    address: string | null;
    role: string;
    pinHash?: string | null;
    isTester?: boolean;
    canPreviewAll?: boolean;
  }) {
    return {
      id: user.id.toString(),
      phone: user.phone,
      displayName: user.displayName,
      email: user.email,
      address: user.address,
      role: user.role,
      // Which catalogue this account is served. Absent from this payload
      // until now, which made a misplaced flag invisible from inside the app:
      // early access granted to a mistyped number looked identical to a bug
      // in the guards, and could only be told apart by querying the database.
      isTester: Boolean(user.isTester),
      canPreviewAll: Boolean(user.canPreviewAll),
      // Never the PIN itself — only whether one exists, so the account screen
      // can offer "set" or "change" without the hash ever leaving the server.
      pinSet: Boolean(user.pinHash),
    };
  }
}
