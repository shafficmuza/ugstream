import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ArtworkService } from './artwork.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { StaffGuard } from '../common/guards/staff.guard';

/** Generate poster/banner artwork from a title's own video. */
@UseGuards(JwtAuthGuard, StaffGuard)
@Controller('admin/titles/:id/artwork')
export class ArtworkController {
  constructor(private readonly artwork: ArtworkService) {}

  /** Sample candidate frames for a human to choose from. */
  @Post('candidates')
  candidates(@Param('id') id: string) {
    return this.artwork.generateCandidates(BigInt(id));
  }

  /** Turn the chosen frame into a poster + banner and attach them. */
  @Post('apply')
  apply(@Param('id') id: string, @Body() body: { candidate: string }) {
    return this.artwork.applyCandidate(BigInt(id), body.candidate);
  }
}
