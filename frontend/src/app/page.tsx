import Link from 'next/link';
import { apiFetch } from '@/lib/api';

interface TitleCard {
  id: string;
  slug: string;
  name: string;
  posterUrl: string | null;
  access: string;
  priceUgx: number | null;
}

interface Rail {
  rail: string;
  titles: TitleCard[];
}

export default async function HomePage() {
  let rails: Rail[] = [];
  try {
    rails = await apiFetch<Rail[]>('/home');
  } catch {
    // Backend not reachable yet (e.g. first local run before seeding
    // content) — render an empty shell instead of crashing the page.
    rails = [];
  }

  return (
    <main>
      {rails.length === 0 && (
        <p style={{ padding: '0 32px', opacity: 0.7 }}>
          No content published yet — add titles via the admin API.
        </p>
      )}

      {rails.map((rail) => (
        <section className="rail" key={rail.rail}>
          <h2>{rail.rail}</h2>
          <div className="rail-scroller">
            {rail.titles.map((t) => (
              <Link href={`/title/${t.slug}`} key={t.id} className="card">
                <img src={t.posterUrl ?? undefined} alt={t.name} loading="lazy" />
                <div className="card-title">{t.name}</div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
