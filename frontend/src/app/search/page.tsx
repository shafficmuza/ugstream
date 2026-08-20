import { apiFetch } from '@/lib/api';
import { apiFetchAsViewer } from '@/lib/api-server';
import { PosterGrid } from '@/components/poster-grid';
import { TitleCardData } from '@/components/title-card';

interface GenreRef {
  name: string;
  slug: string;
}

export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams.q ?? '').trim();

  let items: TitleCardData[] = [];
  let genres: GenreRef[] = [];
  if (q) {
    [{ items }, genres] = await Promise.all([
      apiFetchAsViewer<{ items: TitleCardData[] }>(`/titles?q=${encodeURIComponent(q)}&per_page=48`),
      apiFetch<GenreRef[]>('/genres').catch(() => [] as GenreRef[]),
    ]);
  }

  if (!q) {
    return (
      <main className="page">
        <p className="empty-state">Start typing in the search box above to find movies and series.</p>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main className="page">
        <div className="search-empty">
          <p>
            Your search for <strong>“{q}”</strong> did not have any matches.
          </p>
          <p className="search-empty-sub">Suggestions:</p>
          <ul>
            <li>Try different keywords</li>
            <li>Try a movie or series title</li>
            {genres.length > 0 && <li>Try a genre like {genres.map((g) => g.name).join(', ')}</li>}
          </ul>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <p className="search-context">
        Explore titles related to: <strong>{q}</strong>
      </p>
      <PosterGrid titles={items} emptyText="" />
    </main>
  );
}
