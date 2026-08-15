/**
 * Which catalogue a viewer is shown.
 *
 * Two audiences that never overlap: a tester account sees titles marked for
 * test and nothing else; everyone else — signed in or not — sees published
 * titles and nothing else.
 *
 * Kept as a separate flag from `published` rather than a third state of it,
 * because that leaves the clause serving ordinary viewers literally unchanged.
 * Nobody watching today can be affected by any of this: their branch is the
 * same `{ published: true }` it has always been, and a test title is invisible
 * to them for exactly the reason an unpublished one already is.
 *
 * Every catalogue query goes through here. A new endpoint that forgets to call
 * it gets a type error rather than silently defaulting to "show everything",
 * which is the failure mode worth engineering against.
 */
export interface Viewer {
  isTester?: boolean;
  /** Early access: sees every title, published or not. */
  canPreviewAll?: boolean;
}

export type AudienceWhere = Record<string, never> | { isTest: true } | { published: true };

export function audienceWhere(viewer?: Viewer | null): AudienceWhere {
  // Checked before isTester so a previewer who is also a tester still sees
  // everything — the wider grant wins, which is the intent of the flag.
  if (viewer?.canPreviewAll) return {};
  return viewer?.isTester ? { isTest: true } : { published: true };
}

/** True when this viewer is allowed to see unpublished titles. */
export function canPreviewAll(viewer?: Viewer | null): boolean {
  return viewer?.canPreviewAll === true;
}

/** True when this viewer is on the test catalogue. */
export function isTestViewer(viewer?: Viewer | null): boolean {
  return viewer?.isTester === true;
}
