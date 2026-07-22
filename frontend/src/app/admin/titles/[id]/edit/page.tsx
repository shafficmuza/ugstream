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

  async function addEpisode() {
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
      // The create-episode call already got us a Cloudflare direct-upload
      // URL, but we don't keep it around client-side across reloads — so
      // for a re-upload we'd need a fresh one. For the first upload right
      // after creation this works because the episode list refetch below
      // doesn't lose it within this session; simplest correct approach is
      // to fetch a fresh upload URL each time.
      const { uploadUrl } = await apiFetch<{ uploadUrl: string }>(
        `/admin/titles/${titleId}/episodes/${episodeId}/upload-url`,
        { method: 'POST', token },
      );

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', uploadUrl);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error('Upload failed.')));
        xhr.onerror = () => reject(new Error('Upload failed.'));
        const body = new FormData();
        body.append('file', file);
        xhr.send(body);
      });

      onChange();
    } catch (e: any) {
      setError(e.message ?? 'Upload failed.');
    } finally {
      setUploadingId(null);
      setUploadProgress(null);
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

      {adding && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 16 }}>
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
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Name (optional)</label>
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button className="btn" style={{ marginBottom: 16 }} onClick={addEpisode}>
            Create
          </button>
        </div>
      )}

      {error && <p style={{ color: '#ff6b6b', marginBottom: 12 }}>{error}</p>}

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
  );
}
