import Link from 'next/link';

export interface BillboardData {
  id: string;
  slug: string;
  name: string;
  kind?: string;
  description: string | null;
  bannerUrl: string | null;
  posterUrl: string | null;
  access: string;
  releaseYear?: number | null;
  firstEpisodeId?: string | null;
}

export function Billboard({ data, fallbackArt }: { data: BillboardData; fallbackArt?: string | null }) {
  // Wide banner art first; then the admin-uploaded hero background (wide by
  // design); a 2:3 poster only as a last resort since it crops badly here.
  const art = data.bannerUrl ?? fallbackArt ?? data.posterUrl;

  return (
    <div className="billboard" style={art ? { backgroundImage: `url(${art})` } : undefined}>
      <div className="billboard-content">
        <h1 className="billboard-title">{data.name}</h1>
        <div className="billboard-meta">
          {data.releaseYear && <span>{data.releaseYear}</span>}
          {data.kind === 'series' && <span>Series</span>}
          {data.access === 'free' && <span className="badge free">Free</span>}
        </div>
        {data.description && <p className="billboard-desc">{data.description}</p>}
        <div className="billboard-actions">
          <Link
            href={data.firstEpisodeId ? `/watch/${data.firstEpisodeId}` : `/title/${data.slug}?play=1`}
            className="btn-play"
          >
            <span aria-hidden>▶</span> Play
          </Link>
          <Link href={`/title/${data.slug}`} className="btn-more">
            <span aria-hidden>ⓘ</span> More Info
          </Link>
        </div>
      </div>
    </div>
  );
}
