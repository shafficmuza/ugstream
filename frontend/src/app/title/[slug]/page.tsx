import { apiFetch } from '@/lib/api';
import { PlayButton } from './play-button';

interface Episode {
  id: string;
  season: number;
  number: number;
  name: string | null;
  thumbnailUrl: string | null;
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
  genres: string[];
  episodes: Episode[];
}

export default async function TitlePage({ params }: { params: { slug: string } }) {
  const title = await apiFetch<TitleDetail>(`/titles/${params.slug}`);

  return (
    <main>
      <div
        style={{
          backgroundImage: `linear-gradient(to bottom, rgba(11,11,15,0.2), #0b0b0f), url(${title.bannerUrl ?? title.posterUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          padding: '120px 32px 32px',
        }}
      >
        <h1 style={{ fontSize: 32, margin: '0 0 8px' }}>{title.name}</h1>
        <p style={{ opacity: 0.7, fontSize: 14 }}>
          {title.releaseYear} · {title.genres.join(', ')}
        </p>
        <p style={{ maxWidth: 560, lineHeight: 1.5 }}>{title.description}</p>

        {title.kind === 'movie' && title.episodes[0] && (
          <PlayButton episodeId={title.episodes[0].id} label="Play" />
        )}
      </div>

      {title.kind === 'series' && (
        <section style={{ padding: '0 32px 32px' }}>
          <h2 style={{ fontSize: 18 }}>Episodes</h2>
          {title.episodes.map((ep) => (
            <div
              key={ep.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 0',
                borderBottom: '1px solid #222',
              }}
            >
              <span style={{ opacity: 0.6, width: 70 }}>
                S{ep.season} E{ep.number}
              </span>
              <span style={{ flex: 1 }}>{ep.name ?? `Episode ${ep.number}`}</span>
              <PlayButton episodeId={ep.id} label={ep.cfStatus === 'ready' ? 'Play' : 'Processing…'} />
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
