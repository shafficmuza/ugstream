import { apiFetchAsViewer } from '@/lib/api-server';
import { PosterGrid } from '@/components/poster-grid';
import { TitleCardData } from '@/components/title-card';

export default async function KidsPage() {
  const { items } = await apiFetchAsViewer<{ items: TitleCardData[] }>('/titles?genre=kids&per_page=48');
  return (
    <main className="page">
      <h1 className="page-title">Kids</h1>
      <PosterGrid titles={items} emptyText="No kids titles published yet." />
    </main>
  );
}
