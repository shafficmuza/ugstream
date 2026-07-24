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
  firstEpisodeId?: string | null;
}

function accessBadge(access: string) {
  if (access === 'free') return <span className="badge free">Free</span>;
  return null;
}

/**
 * Poster card with Netflix-style hover: delayed zoom, info overlay, and a
 * round quick-play button that deep-links to /watch/:episodeId. The play
 * button is a *sibling* of the main link (absolutely positioned above it)
 * — nesting links is invalid HTML.
 */
export function TitleCard({ title, progress }: { title: TitleCardData; progress?: number }) {
  return (
    <div className="card">
      <Link href={`/title/${title.slug}`} className="card-link" title={title.name}>
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
      {title.firstEpisodeId && (
        <Link
          href={`/watch/${title.firstEpisodeId}`}
          className="card-play-btn"
          aria-label={`Play ${title.name}`}
          title={`Play ${title.name}`}
        >
          <span aria-hidden>▶</span>
        </Link>
      )}
    </div>
  );
}
