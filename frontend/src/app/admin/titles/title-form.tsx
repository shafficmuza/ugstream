'use client';

import { useEffect, useState } from 'react';
import { labelStyle, inputStyle, uploadFile } from '../shared';

export interface Genre {
  id: number;
  name: string;
}

export interface TitleFormValues {
  kind: 'movie' | 'series';
  name: string;
  slug: string;
  description: string;
  language: string;
  vjName: string;
  releaseYear: string;
  posterUrl: string;
  bannerUrl: string;
  access: 'free' | 'subscription' | 'purchase' | 'sub_or_purchase';
  priceUgx: string;
  rentalHours: string;
  genreIds: number[];
}

export const emptyTitleForm: TitleFormValues = {
  kind: 'movie',
  name: '',
  slug: '',
  description: '',
  language: '',
  vjName: '',
  releaseYear: '',
  posterUrl: '',
  bannerUrl: '',
  access: 'subscription',
  priceUgx: '',
  rentalHours: '72',
  genreIds: [],
};

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function TitleForm({
  value,
  onChange,
  slugEditable = true,
}: {
  value: TitleFormValues;
  onChange: (v: TitleFormValues) => void;
  slugEditable?: boolean;
}) {
  const [genres, setGenres] = useState<Genre[]>([]);
  const [uploadingPoster, setUploadingPoster] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4001/v1'}/genres`)
      .then((r) => r.json())
      .then(setGenres)
      .catch(() => setGenres([]));
  }, []);

  function set<K extends keyof TitleFormValues>(key: K, val: TitleFormValues[K]) {
    onChange({ ...value, [key]: val });
  }

  async function handlePosterUpload(file: File) {
    setUploadingPoster(true);
    try {
      const { url } = await uploadFile('/admin/media/image', file);
      set('posterUrl', url);
    } finally {
      setUploadingPoster(false);
    }
  }

  async function handleBannerUpload(file: File) {
    setUploadingBanner(true);
    try {
      const { url } = await uploadFile('/admin/media/image', file);
      set('bannerUrl', url);
    } finally {
      setUploadingBanner(false);
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <label style={labelStyle}>Kind</label>
      <select
        style={inputStyle}
        value={value.kind}
        onChange={(e) => set('kind', e.target.value as 'movie' | 'series')}
      >
        <option value="movie">Movie</option>
        <option value="series">Series</option>
      </select>

      <label style={labelStyle}>Name</label>
      <input
        style={inputStyle}
        value={value.name}
        onChange={(e) => {
          const name = e.target.value;
          onChange({ ...value, name, slug: slugEditable ? slugify(name) : value.slug });
        }}
      />

      <label style={labelStyle}>Slug</label>
      <input style={inputStyle} value={value.slug} onChange={(e) => set('slug', slugify(e.target.value))} />

      <label style={labelStyle}>Description</label>
      <textarea
        style={{ ...inputStyle, minHeight: 80 }}
        value={value.description}
        onChange={(e) => set('description', e.target.value)}
      />

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={labelStyle}>Language</label>
          <input style={inputStyle} value={value.language} onChange={(e) => set('language', e.target.value)} />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={labelStyle}>VJ name (optional)</label>
          <input style={inputStyle} value={value.vjName} onChange={(e) => set('vjName', e.target.value)} />
        </div>
        <div style={{ width: 100, flexGrow: 1 }}>
          <label style={labelStyle}>Year</label>
          <input style={inputStyle} value={value.releaseYear} onChange={(e) => set('releaseYear', e.target.value)} />
        </div>
      </div>

      <label style={labelStyle}>Genres</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        {genres.map((g) => (
          <label key={g.id} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="checkbox"
              checked={value.genreIds.includes(g.id)}
              onChange={(e) =>
                set(
                  'genreIds',
                  e.target.checked ? [...value.genreIds, g.id] : value.genreIds.filter((id) => id !== g.id),
                )
              }
            />
            {g.name}
          </label>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={labelStyle}>Poster</label>
          {value.posterUrl && <img src={value.posterUrl} alt="" style={{ height: 90, display: 'block', marginBottom: 8 }} />}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={uploadingPoster}
            onChange={(e) => e.target.files?.[0] && handlePosterUpload(e.target.files[0])}
          />
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={labelStyle}>Banner</label>
          {value.bannerUrl && <img src={value.bannerUrl} alt="" style={{ height: 90, display: 'block', marginBottom: 8 }} />}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={uploadingBanner}
            onChange={(e) => e.target.files?.[0] && handleBannerUpload(e.target.files[0])}
          />
        </div>
      </div>

      <div style={{ height: 16 }} />

      <label style={labelStyle}>Access</label>
      <select style={inputStyle} value={value.access} onChange={(e) => set('access', e.target.value as TitleFormValues['access'])}>
        <option value="free">Free</option>
        <option value="subscription">Subscription only</option>
        <option value="purchase">Pay-per-title only</option>
        <option value="sub_or_purchase">Subscription or pay-per-title</option>
      </select>

      {(value.access === 'purchase' || value.access === 'sub_or_purchase') && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={labelStyle}>Price (UGX)</label>
            <input style={inputStyle} value={value.priceUgx} onChange={(e) => set('priceUgx', e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={labelStyle}>Rental window (hours)</label>
            <input style={inputStyle} value={value.rentalHours} onChange={(e) => set('rentalHours', e.target.value)} />
          </div>
        </div>
      )}
    </div>
  );
}

export function toUpsertPayload(v: TitleFormValues) {
  return {
    kind: v.kind,
    name: v.name,
    slug: v.slug,
    description: v.description || undefined,
    language: v.language || undefined,
    vjName: v.vjName || undefined,
    releaseYear: v.releaseYear ? parseInt(v.releaseYear, 10) : undefined,
    posterUrl: v.posterUrl || undefined,
    bannerUrl: v.bannerUrl || undefined,
    access: v.access,
    priceUgx: v.priceUgx ? parseInt(v.priceUgx, 10) : undefined,
    rentalHours: v.rentalHours ? parseInt(v.rentalHours, 10) : undefined,
    genreIds: v.genreIds,
  };
}
