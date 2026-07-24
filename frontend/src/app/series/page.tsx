import { apiFetch } from '@/lib/api';
import { PosterGrid } from '@/components/poster-grid';
import { TitleCardData } from '@/components/title-card';

export default async function SeriesPage() {
  const { items } = await apiFetch<{ items: TitleCardData[] }>('/titles?kind=series&per_page=48');
  return (
    <main className="page">
      <h1 className="page-title">Series</h1>
      <PosterGrid titles={items} emptyText="No series published yet." />
    </main>
  );
}
