import { apiFetch } from '@/lib/api';
import { PosterGrid } from '@/components/poster-grid';
import { TitleCardData } from '@/components/title-card';

export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams.q ?? '').trim();

  let items: TitleCardData[] = [];
  if (q) {
    ({ items } = await apiFetch<{ items: TitleCardData[] }>(
      `/titles?q=${encodeURIComponent(q)}&per_page=48`,
    ));
  }

  return (
    <main className="page">
      <h1 className="page-title">{q ? `Results for “${q}”` : 'Search'}</h1>
      {q ? (
        <PosterGrid titles={items} emptyText={`Nothing found for “${q}”.`} />
      ) : (
        <p className="empty-state">Type in the search box above to find movies and series.</p>
      )}
    </main>
  );
}
