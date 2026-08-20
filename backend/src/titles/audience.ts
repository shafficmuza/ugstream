/**
 * Which catalogue a viewer is shown.
 *
 * The site runs in one of two modes, set by an admin (AppSettings.catalogueMode):
 *
 *   test  — the whole site is the test catalogue. Everyone sees titles marked
 *           for test and nothing else, signed in or not, including visitors
 *           who have never had an account. Only an Early access account sees
 *           the published catalogue that is being held back.
 *
 *   live  — the ordinary arrangement for after launch. Everyone sees published
 *           titles; a tester account sees the test catalogue instead.
 *
 * A mode rather than a constant because it has to be switched on launch day
 * without a deploy, and because "why is the site showing test content" should
 * be answerable from the admin panel rather than from the source.
 *
 * In BOTH modes an Early access account sees everything. That is what makes
 * "only Early access sees published, non-test titles" true in test mode: for
 * everyone else the published catalogue simply is not reachable.
 *
 * Every catalogue query goes through here. A new endpoint that forgets to call
 * it gets a type error rather than silently defaulting to "show everything",
 * which is the failure mode worth engineering against.
 */
export interface Viewer {
  isTester?: boolean;
  /** Early access: sees every title, published or not, in either mode. */
  canPreviewAll?: boolean;
}

export type CatalogueMode = 'test' | 'live';

export type AudienceWhere = Record<string, never> | { isTest: true } | { published: true };

export function audienceWhere(viewer: Viewer | null | undefined, mode: CatalogueMode): AudienceWhere {
  // Checked first so an Early access account sees everything in either mode —
  // the wider grant wins, which is the intent of the flag.
  if (viewer?.canPreviewAll) return {};
  if (mode === 'test') return { isTest: true };
  return viewer?.isTester ? { isTest: true } : { published: true };
}

/** The same rule as SQL, for the one query that cannot use a Prisma where. */
export function audienceSql(viewer: Viewer | null | undefined, mode: CatalogueMode): string {
  if (viewer?.canPreviewAll) return 'TRUE';
  if (mode === 'test') return 't.is_test = true';
  return viewer?.isTester ? 't.is_test = true' : 't.published = true';
}

/** True when this viewer may play a title with these flags. */
export function mayViewTitle(
  viewer: Viewer | null | undefined,
  title: { isTest: boolean; published: boolean },
  mode: CatalogueMode,
): boolean {
  if (viewer?.canPreviewAll) return true;
  if (mode === 'test') return title.isTest;
  return viewer?.isTester ? title.isTest : title.published;
}

/** True when this viewer is allowed to see unpublished titles. */
export function canPreviewAll(viewer?: Viewer | null): boolean {
  return viewer?.canPreviewAll === true;
}

/** True when this viewer is on the test catalogue. */
export function isTestViewer(viewer?: Viewer | null): boolean {
  return viewer?.isTester === true;
}
