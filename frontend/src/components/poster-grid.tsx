import { TitleCard, TitleCardData } from './title-card';

export function PosterGrid({ titles, emptyText }: { titles: TitleCardData[]; emptyText: string }) {
  if (titles.length === 0) {
    return <p className="empty-state">{emptyText}</p>;
  }
  return (
    <div className="poster-grid">
      {titles.map((t) => (
        <TitleCard key={t.id} title={t} />
      ))}
    </div>
  );
}
