'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { TitleForm, emptyTitleForm, toUpsertPayload, TitleFormValues } from '../../title-form';
import { tableStyle, thStyle, tdStyle, inputStyle, labelStyle } from '../../../shared';

interface Episode {
  id: string;
  season: number;
  number: number;
  name: string | null;
  cfStatus: 'pending' | 'uploading' | 'ready' | 'error';
  durationSecs: number | null;
}

export default function EditTitlePage() {
  const params = useParams<{ id: string }>();
  const [form, setForm] = useState<TitleFormValues>(emptyTitleForm);
  const [kind, setKind] = useState<'movie' | 'series'>('movie');
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function load() {
    const token = getAccessToken();
    if (!token) return;
    apiFetch<any>(`/admin/titles/${params.id}`, { token }).then((t) => {
      setKind(t.kind);
      setForm({
        kind: t.kind,
        name: t.name,
        slug: t.slug,
        description: t.description ?? '',
        language: t.language ?? '',
        vjName: t.vjName ?? '',
        releaseYear: t.releaseYear ? String(t.releaseYear) : '',
        posterUrl: t.posterUrl ?? '',
        bannerUrl: t.bannerUrl ?? '',
        access: t.access,
        priceUgx: t.priceUgx ? String(t.priceUgx) : '',
        rentalHours: String(t.rentalHours ?? 72),
        genreIds: t.genreIds ?? [],
      });
      setEpisodes(t.episodes ?? []);
      setLoaded(true);
    });
  }

  useEffect(load, [params.id]);

  async function save() {
    const token = getAccessToken();
    if (!token) return;
    setSaving(true);
    setMessage(null);
    try {
      await apiFetch(`/admin/titles/${params.id}`, {
        method: 'PATCH',
        token,
        body: toUpsertPayload(form),
      });
      setMessage('Saved.');
    } catch (e: any) {
      setMessage(e.message ?? 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <p>Loading…</p>;

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 24 }}>Edit title</h1>
      <TitleForm value={form} onChange={setForm} slugEditable={false} />
      <button className="btn" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </button>
      {message && <p style={{ marginTop: 12, opacity: 0.8 }}>{message}</p>}

      <hr style={{ margin: '32px 0', borderColor: '#222' }} />

      <EpisodesSection titleId={params.id} kind={kind} episodes={episodes} onChange={load} />
    </div>
  );
}

function EpisodesSection({
  titleId,
  kind,
  episodes,
  onChange,
}: {
  titleId: string;
  kind: 'movie' | 'series';
  episodes: Episode[];
  onChange: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [season, setSeason] = useState('1');
  const [number, setNumber] = useState(String(episodes.length + 1));
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);

  async function addEpisode(e?: React.FormEvent) {
    e?.preventDefault();
    const token = getAccessToken();
    if (!token) return;
    setError(null);
    try {
      await apiFetch(`/admin/titles/${titleId}/episodes`, {
        method: 'POST',
        token,
        body: {
          season: kind === 'series' ? parseInt(season, 10) : 1,
          number: kind === 'series' ? parseInt(number, 10) : 1,
          name: name || undefined,
        },
      });
      setAdding(false);
      setName('');
      onChange();
    } catch (e: any) {
      setError(e.message ?? 'Failed to add episode. Is Cloudflare Stream configured?');
    }
  }

  async function uploadVideo(episodeId: string, file: File) {
    const token = getAccessToken();
    if (!token) return;
    setUploadingId(episodeId);
    setUploadProgress(0);
    setError(null);
    try {
      // Resumable (TUS) upload — the old single-POST direct_upload capped
      // at ~200MB, so any real movie (a 2GB file) failed every time and
      // left an orphaned "pending" video behind. TUS chunks the file
      // (resumable, retries on flaky connections) up to 30GB. The backend
      // pre-creates the Cloudflare upload and returns its tus URL.
      const { uploadUrl } = await apiFetch<{ uploadUrl: string }>(
        `/admin/titles/${titleId}/episodes/${episodeId}/tus-upload`,
        { method: 'POST', token, body: { uploadLength: file.size, filename: file.name } },
      );

      const tus = await import('tus-js-client');
      await new Promise<void>((resolve, reject) => {
        const upload = new tus.Upload(file, {
          uploadUrl, // Cloudflare already created the upload server-side
          // 50MB chunks (multiple of 256KiB, as Cloudflare requires).
          chunkSize: 50 * 1024 * 1024,
          retryDelays: [0, 3000, 5000, 10000, 20000],
          metadata: { filename: file.name, filetype: file.type },
          onError: reject,
          onProgress: (sent, total) => setUploadProgress(Math.round((sent / total) * 100)),
          onSuccess: () => resolve(),
        });
        upload.start();
      });

      onChange();
    } catch (e: any) {
      setError(e.message ?? 'Upload failed.');
    } finally {
      setUploadingId(null);
      setUploadProgress(null);
    }
  }

  async function importVideoFromUrl(e?: React.FormEvent) {
    e?.preventDefault();
    const token = getAccessToken();
    if (!token || !importUrl.trim()) return;
    setImporting(true);
    setError(null);
    try {
      await apiFetch(`/admin/titles/${titleId}/episodes/import-url`, {
        method: 'POST',
        token,
        body: {
          url: importUrl.trim(),
          name: name || undefined,
          season: kind === 'series' ? parseInt(season, 10) : 1,
          number: kind === 'series' ? parseInt(number, 10) : 1,
        },
      });
      setImportUrl('');
      onChange();
    } catch (e: any) {
      setError(e.message ?? 'Import failed. Check the URL is a direct, publicly reachable video link.');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18 }}>{kind === 'series' ? 'Episodes' : 'Video'}</h2>
        {(kind === 'series' || episodes.length === 0) && (
          <button className="btn" onClick={() => setAdding(!adding)}>
            {adding ? 'Cancel' : '+ Add ' + (kind === 'series' ? 'episode' : 'video')}
          </button>
        )}
      </div>

      <form
        onSubmit={importVideoFromUrl}
        style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <label style={labelStyle}>Import from a direct video URL (best for large files — no browser upload)</label>
          <input
            style={inputStyle}
            type="url"
            placeholder="https://…/movie.mp4"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
          />
        </div>
        <button className="btn" style={{ marginBottom: 16 }} type="submit" disabled={importing || !importUrl.trim()}>
          {importing ? 'Importing…' : 'Import'}
        </button>
      </form>

      {adding && (
        <form onSubmit={addEpisode} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
          {kind === 'series' && (
            <>
              <div>
                <label style={labelStyle}>Season</label>
                <input style={{ ...inputStyle, width: 80 }} value={season} onChange={(e) => setSeason(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Number</label>
                <input style={{ ...inputStyle, width: 80 }} value={number} onChange={(e) => setNumber(e.target.value)} />
              </div>
            </>
          )}
          <div style={{ flex: 1, minWidth: 160 }}>
            <label style={labelStyle}>Name (optional)</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button className="btn" style={{ marginBottom: 16 }} type="submit">
            Create
          </button>
        </form>
      )}

      {error && <p style={{ color: '#ff6b6b', marginBottom: 12 }}>{error}</p>}

      <div className="table-wrap">
      <table style={tableStyle}>
        <thead>
          <tr>
            {kind === 'series' && <th style={thStyle}>S/E</th>}
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Video</th>
          </tr>
        </thead>
        <tbody>
          {episodes.map((ep) => (
            <tr key={ep.id}>
              {kind === 'series' && (
                <td style={tdStyle}>
                  S{ep.season} E{ep.number}
                </td>
              )}
              <td style={tdStyle}>{ep.name ?? '—'}</td>
              <td style={tdStyle}>{ep.cfStatus}</td>
              <td style={tdStyle}>
                {uploadingId === ep.id ? (
                  `Uploading… ${uploadProgress ?? 0}%`
                ) : (
                  <input
                    type="file"
                    accept="video/*"
                    title="Resumable upload — large files (movies) supported"
                    onChange={(e) => e.target.files?.[0] && uploadVideo(ep.id, e.target.files[0])}
                  />
                )}
              </td>
            </tr>
          ))}
          {episodes.length === 0 && (
            <tr>
              <td style={tdStyle} colSpan={4}>
                No video uploaded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
    </div>
  );
}
