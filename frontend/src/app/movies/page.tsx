import { apiFetchAsViewer } from '@/lib/api-server';
import { PosterGrid } from '@/components/poster-grid';
import { TitleCardData } from '@/components/title-card';

export default async function MoviesPage() {
  const { items } = await apiFetchAsViewer<{ items: TitleCardData[] }>('/titles?kind=movie&per_page=48');
  return (
    <main className="page">
      <h1 className="page-title">Movies</h1>
      <PosterGrid titles={items} emptyText="No movies published yet." />
    </main>
  );
}
