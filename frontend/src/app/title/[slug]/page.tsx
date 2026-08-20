import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiFetchAsViewer } from '@/lib/api-server';
import { BackButton } from '@/components/back-button';
import { MyListButton } from '@/components/my-list-button';
import { PosterGrid } from '@/components/poster-grid';
import { TitleCardData } from '@/components/title-card';

interface Episode {
  id: string;
  season: number;
  number: number;
  name: string | null;
  thumbnailUrl: string | null;
  durationSecs: number | null;
  cfStatus: string;
}

interface TitleDetail {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  posterUrl: string | null;
  bannerUrl: string | null;
  kind: 'movie' | 'series';
  access: string;
  priceUgx: number | null;
  releaseYear: number | null;
  language: string | null;
  vjName: string | null;
  genres: string[];
  episodes: Episode[];
}

function formatDuration(secs: number | null): string | null {
  if (!secs) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function accessLabel(access: string, priceUgx: number | null): string | null {
  switch (access) {
    case 'free':
      return 'Free';
    case 'subscription':
      return 'Subscription';
    case 'purchase':
      return priceUgx ? `Rent · UGX ${priceUgx.toLocaleString()}` : 'Rent';
    case 'sub_or_purchase':
      return priceUgx ? `Subscription or UGX ${priceUgx.toLocaleString()}` : 'Subscription';
    default:
      return null;
  }
}

export default async function TitlePage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams: { play?: string };
}) {
  const [title, similar] = await Promise.all([
    apiFetchAsViewer<TitleDetail>(`/titles/${params.slug}`),
    apiFetchAsViewer<TitleCardData[]>(`/titles/${params.slug}/similar`).catch(() => [] as TitleCardData[]),
  ]);

  const art = title.bannerUrl ?? title.posterUrl;
  const firstPlayable = title.episodes.find((e) => e.cfStatus === 'ready');
  const movieDuration = title.kind === 'movie' ? formatDuration(title.episodes[0]?.durationSecs ?? null) : null;

  // Deep links like /title/slug?play=1 (billboard Play, older bookmarks)
  // go straight to the full-page player.
  if (searchParams.play === '1' && firstPlayable) {
    redirect(`/watch/${firstPlayable.id}`);
  }

  return (
    <main>
      <BackButton />
      <div className="title-hero" style={art ? { backgroundImage: `url(${art})` } : undefined}>
        <div className="title-hero-content">
          <h1>{title.name}</h1>

          <div className="title-meta">
            {title.releaseYear && <span>{title.releaseYear}</span>}
            {movieDuration && <span>{movieDuration}</span>}
            {title.kind === 'series' && <span>{title.episodes.length} episodes</span>}
            {title.genres.length > 0 && <span>{title.genres.join(' · ')}</span>}
            {title.vjName && <span>VJ: {title.vjName}</span>}
            {accessLabel(title.access, title.priceUgx) && (
              <span className={title.access === 'free' ? 'badge free' : 'badge'}>
                {accessLabel(title.access, title.priceUgx)}
              </span>
            )}
          </div>

          {title.description && <p className="title-desc">{title.description}</p>}

          <div className="billboard-actions">
            {firstPlayable && (
              <Link href={`/watch/${firstPlayable.id}`} className="btn-play">
                <span aria-hidden>▶</span> Play
              </Link>
            )}
            <MyListButton titleId={title.id} />
          </div>
        </div>
      </div>

      {title.kind === 'series' && (
        <section className="section">
          <h2>Episodes</h2>
          {title.episodes.map((ep) => (
            <div key={ep.id} className="episode-row">
              <span className="episode-num">{ep.number}</span>
              {ep.thumbnailUrl ? (
                <img className="episode-thumb" src={ep.thumbnailUrl} alt="" loading="lazy" />
              ) : (
                <div className="episode-thumb" />
              )}
              <div className="episode-info">
                <div className="episode-name">
                  {ep.name ?? `Episode ${ep.number}`}
                  {title.episodes.some((e) => e.season !== 1) && (
                    <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> · S{ep.season}</span>
                  )}
                </div>
                {formatDuration(ep.durationSecs) && (
                  <div className="episode-sub">{formatDuration(ep.durationSecs)}</div>
                )}
              </div>
              {ep.cfStatus === 'ready' ? (
                <Link href={`/watch/${ep.id}`} className="btn">
                  <span aria-hidden>▶</span> Play
                </Link>
              ) : (
                <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>Processing…</span>
              )}
            </div>
          ))}
        </section>
      )}

      {similar.length > 0 && (
        <section className="section">
          <h2>More Like This</h2>
          <PosterGrid titles={similar} emptyText="" />
        </section>
      )}

      <div style={{ height: 60 }} />
    </main>
  );
}
