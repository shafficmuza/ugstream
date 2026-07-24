import Link from 'next/link';

export interface TitleCardData {
  id: string;
  slug: string;
  name: string;
  kind?: string;
  posterUrl: string | null;
  access: string;
  priceUgx?: number | null;
  releaseYear?: number | null;
}

function accessBadge(access: string) {
  if (access === 'free') return <span className="badge free">Free</span>;
  return null;
}

export function TitleCard({ title, progress }: { title: TitleCardData; progress?: number }) {
  return (
    <Link href={`/title/${title.slug}`} className="card" title={title.name}>
      <img src={title.posterUrl ?? undefined} alt={title.name} loading="lazy" />
      <div className="card-overlay">
        <div className="card-name">{title.name}</div>
        <div className="card-sub">
          {[title.releaseYear, title.kind === 'series' ? 'Series' : null]
            .filter(Boolean)
            .join(' · ')}{' '}
          {accessBadge(title.access)}
        </div>
        {typeof progress === 'number' && (
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${Math.min(100, Math.round(progress * 100))}%` }} />
          </div>
        )}
      </div>
    </Link>
  );
}
