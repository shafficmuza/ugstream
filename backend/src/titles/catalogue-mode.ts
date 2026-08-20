import { PrismaService } from '../prisma/prisma.service';
import { CatalogueMode } from './audience';

/**
 * The site's current catalogue mode.
 *
 * Read per request, the same way the concurrent-stream limit is: one indexed
 * lookup on a singleton row, and an admin flipping the switch takes effect
 * immediately rather than at the next restart.
 *
 * Anything other than an explicit 'live' reads as 'test'. That is deliberate:
 * a missing settings row, an unrun migration or a typo should leave the site
 * showing test content, never quietly publish the held-back catalogue.
 */
export async function readCatalogueMode(prisma: PrismaService): Promise<CatalogueMode> {
  const settings = await prisma.appSettings.findUnique({
    where: { id: 1 },
    select: { catalogueMode: true },
  });
  return settings?.catalogueMode === 'live' ? 'live' : 'test';
}
