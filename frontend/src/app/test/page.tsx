import type { Metadata } from 'next';
import { apiFetch } from '@/lib/api';
import { Rail } from '@/components/rail';
import { TitleCard, TitleCardData } from '@/components/title-card';

interface TestRail {
  key: string;
  rail: string;
  titles: TitleCardData[];
}

interface TestHomePayload {
  billboard: TitleCardData | null;
  rails: TestRail[];
}

/**
 * Unlisted on purpose. The link is handed to testers directly, so it should
 * not turn up in search or be crawled alongside the live catalogue.
 */
export const metadata: Metadata = {
  title: 'Test catalogue — Muza Watch',
  description: 'Preview build. Titles here are for testing and are not part of the live catalogue.',
  robots: { index: false, follow: false },
};

export default async function TestCataloguePage() {
  let data: TestHomePayload = { billboard: null, rails: [] };
  try {
    data = await apiFetch<TestHomePayload>('/test-home');
  } catch {
    // Backend unreachable — render the shell with the explanation rather than
    // an error page, so a tester still knows what they are looking at.
  }
  const empty = data.rails.every((r) => r.titles.length === 0);

  return (
    <main style={{ padding: '24px 0 60px' }}>
      {empty ? (
        <p style={{ margin: '0 4%', opacity: 0.6 }}>
          No titles have been added to the test catalogue yet.
        </p>
      ) : (
        data.rails
          .filter((r) => r.titles.length > 0)
          .map((r) => (
            <Rail key={r.key} heading={r.rail}>
              {r.titles.map((t) => (
                <TitleCard key={t.slug} title={t} />
              ))}
            </Rail>
          ))
      )}
    </main>
  );
}
