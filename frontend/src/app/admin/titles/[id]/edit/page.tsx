'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { TitleForm, emptyTitleForm, toUpsertPayload, TitleFormValues } from '../../title-form';
import { ArtworkPanel } from './artwork-panel';
import { tableStyle, thStyle, tdStyle, inputStyle, labelStyle, uploadToR2, uploadLadderToR2 } from '../../../shared';

interface Episode {
  id: string;
  season: number;
  number: number;
  name: string | null;
  cfStatus: 'pending' | 'uploading' | 'ready' | 'error';
  durationSecs: number | null;
  videoProvider?: string;
}

export default function EditTitlePage() {
  const params = useParams<{ id: string }>();
  const [form, setForm] = useState<TitleFormValues>(emptyTitleForm);
  const [kind, setKind] = useState<string>('movie');
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

      <ArtworkPanel
        titleId={params.id}
        titleName={form.name}
        kind={form.kind}
        year={form.releaseYear}
        onApplied={load}
      />

      <hr style={{ margin: '32px 0', borderColor: '#222' }} />

      <EpisodesSection titleId={params.id} kind={kind} episodes={episodes} onChange={load} />
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #2a2a2a', borderRadius: 8, padding: '14px 16px', background: '#111',
};
const cardHeadStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  fontWeight: 600, fontSize: 15, marginBottom: 6,
};
const cardTextStyle: React.CSSProperties = {
  opacity: 0.72, fontSize: 13, lineHeight: 1.55, marginBottom: 12,
};
const busyStyle: React.CSSProperties = { fontSize: 13, color: '#8ec3e6' };
function pillStyle(bg: string, fg: string): React.CSSProperties {
  return { background: bg, color: fg, fontSize: 11, padding: '3px 8px', borderRadius: 10, fontWeight: 600 };
}

function providerLabel(p?: string): string {
  if (p === 'r2_hls') return '4K · R2 (adaptive)';
  if (p === 'r2_file') return '4K · R2 (file)';
  return '≤1080p · Stream';
}

function EpisodesSection({
  titleId,
  kind,
  episodes,
  onChange,
}: {
  titleId: string;
  kind: string;
  episodes: Episode[];
  onChange: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [season, setSeason] = useState('1');
  const [number, setNumber] = useState('1');
  // Typing your own episode number stops the suggestion below from
  // overwriting it; switching season starts suggesting again.
  const [numberTouched, setNumberTouched] = useState(false);

  // Next free number WITHIN the selected season. The old default counted
  // every season at once — a season 1 with six episodes made season 2 start
  // at 7 — and, being a useState initialiser, never refreshed after an
  // episode was added. So adding several in a row reused one number and each
  // upload after the first was refused as a clash.
  const nextNumber = useMemo(() => {
    const s = parseInt(season, 10);
    return episodes
      .filter((e) => e.season === (Number.isNaN(s) ? 1 : s))
      .reduce((max, e) => Math.max(max, e.number), 0) + 1;
  }, [episodes, season]);

  useEffect(() => {
    if (!numberTouched) setNumber(String(nextNumber));
  }, [nextNumber, numberTouched]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  // Closing the tab mid-upload silently kills the transfer (the tus URL
  // lives only in this tab) — warn before letting the admin leave.
  useEffect(() => {
    if (!uploadingId) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uploadingId]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);

  // 4K-via-R2 upload panel state
  const [r2Mode, setR2Mode] = useState<'file' | 'transcode' | 'ladder'>('file');
  const [r2Busy, setR2Busy] = useState(false);
  const [r2Progress, setR2Progress] = useState<number | null>(null);
  const [r2Phase, setR2Phase] = useState<string>('');

  async function uploadLadder(fileList: FileList) {
    const token = getAccessToken();
    if (!token) return;
    setError(null);
    const files = Array.from(fileList);
    // Strip the top-level folder the browser prepends to every path.
    const rel = (f: File) => (f.webkitRelativePath || f.name).split('/').slice(1).join('/');

    // Find the master playlist (the .m3u8 that lists variant streams).
    let masterFile: File | null = null;
    for (const f of files) {
      if (f.name.toLowerCase().endsWith('.m3u8')) {
        const text = await f.text();
        if (text.includes('#EXT-X-STREAM-INF')) {
          masterFile = f;
          break;
        }
      }
    }
    if (!masterFile) {
      setError(
        'No master playlist found. Your folder must contain a master .m3u8 that lists the quality variants (contains #EXT-X-STREAM-INF). For a single-quality file, use "Ready 4K file" instead.',
      );
      return;
    }

    // Build the upload list: master → normalized "master.m3u8", everything
    // else at its relative path. Skip the master's original path to avoid dupes.
    const entries: { path: string; file: File }[] = [{ path: 'master.m3u8', file: masterFile }];
    for (const f of files) {
      if (f === masterFile) continue;
      const p = rel(f);
      if (!p || p === 'master.m3u8') continue;
      entries.push({ path: p, file: f });
    }

    const s = kind === 'series' ? parseInt(season, 10) : 1;
    const n = kind === 'series' ? parseInt(number, 10) : 1;
    setR2Busy(true);
    setR2Progress(0);
    setR2Phase(`Uploading ${entries.length} files to R2…`);
    try {
      const { prefix } = await apiFetch<{ prefix: string }>('/admin/r2/hls/begin', {
        method: 'POST',
        token,
      });
      await uploadLadderToR2(prefix, entries, setR2Progress);
      setR2Phase('Publishing…');
      await apiFetch(`/admin/titles/${titleId}/episodes/register-r2-hls`, {
        method: 'POST',
        token,
        body: { prefix, name: name || undefined, season: s, number: n },
      });
      onChange();
    } catch (e: any) {
      setError(e.message ?? 'Ladder upload failed.');
    } finally {
      setR2Busy(false);
      setR2Progress(null);
      setR2Phase('');
    }
  }

  async function upload4k(file: File) {
    const token = getAccessToken();
    if (!token) return;
    setError(null);
    setR2Busy(true);
    setR2Progress(0);
    setR2Phase('Uploading to R2…');
    const s = kind === 'series' ? parseInt(season, 10) : 1;
    const n = kind === 'series' ? parseInt(number, 10) : 1;
    try {
      const purpose = r2Mode === 'file' ? 'final' : 'source';
      const key = await uploadToR2(file, purpose, setR2Progress);
      if (r2Mode === 'file') {
        setR2Phase('Publishing…');
        await apiFetch(`/admin/titles/${titleId}/episodes/register-r2-file`, {
          method: 'POST',
          token,
          body: { key, name: name || undefined, season: s, number: n },
        });
      } else {
        setR2Phase('Starting transcode…');
        await apiFetch(`/admin/titles/${titleId}/episodes/transcode-4k-r2`, {
          method: 'POST',
          token,
          body: { key, name: name || undefined, season: s, number: n },
        });
      }
      onChange();
    } catch (e: any) {
      setError(e.message ?? '4K upload failed.');
    } finally {
      setR2Busy(false);
      setR2Progress(null);
      setR2Phase('');
    }
  }

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
          // 16MB chunks (multiple of 256KiB, as Cloudflare requires). Was
          // 50MB: on a slow uplink the first chunk took minutes to commit,
          // so a tab closed early left a zero-byte upload behind — smaller
          // chunks commit progress sooner and retry cheaper.
          chunkSize: 16 * 1024 * 1024,
          retryDelays: [0, 3000, 5000, 10000, 20000, 30000],
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
      // The upload died — hand the slot back so the row doesn't sit on
      // "uploading" forever. Best-effort: the stale-upload self-heal on the
      // backend catches it anyway if this call doesn't land.
      await resetUpload(episodeId, { silent: true });
    } finally {
      setUploadingId(null);
      setUploadProgress(null);
    }
  }

  /** Abandon a stuck/failed upload and return the row to a clean slot. */
  async function resetUpload(episodeId: string, opts?: { silent?: boolean }) {
    const token = getAccessToken();
    if (!token) return;
    try {
      await apiFetch(`/admin/titles/${titleId}/episodes/${episodeId}/cancel-upload`, {
        method: 'POST',
        token,
      });
      onChange();
    } catch (e: any) {
      if (!opts?.silent) setError(e.message ?? 'Could not reset the upload.');
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
      <h2 style={{ fontSize: 18, marginBottom: 6 }}>{kind === 'series' ? 'Episodes' : 'Video'}</h2>
      <p style={{ opacity: 0.6, fontSize: 13, marginBottom: 16 }}>
        Pick the option that matches the file you have. Not sure? Use option 1 — it accepts almost
        any format.
      </p>

      {/* ---- Upload methods, one card per source format ---------------- */}
      <div style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
        <div style={cardStyle}>
          <div style={cardHeadStyle}>
            <span>1 · Upload a video file</span>
            <span style={pillStyle('#1c3d1c', '#7cd47c')}>Recommended</span>
          </div>
          <p style={cardTextStyle}>
            Accepts <b>MP4, MKV, MOV, AVI</b> and most other formats — the video is converted
            automatically into multiple qualities that adapt to each viewer&apos;s connection.
            Maximum quality is <b>1080p</b>. Use this unless you specifically need 4K.
          </p>
          {kind === 'series' || episodes.length === 0 ? (
            <button className="btn" onClick={() => setAdding(!adding)}>
              {adding ? 'Cancel' : `+ Add ${kind === 'series' ? 'episode' : 'video'}`}
            </button>
          ) : (
            <p style={{ ...cardTextStyle, opacity: 0.5, marginBottom: 0 }}>
              A video already exists below — use its row to replace the file.
            </p>
          )}
        </div>

        <div style={cardStyle}>
          <div style={cardHeadStyle}>
            <span>2 · Upload a ready 4K file</span>
            <span style={pillStyle('#2a2a3d', '#8ec3e6')}>4K · fastest</span>
          </div>
          <p style={cardTextStyle}>
            For video you have <b>already encoded yourself</b>. Must be an <b>MP4 using H.264</b> —
            it is served exactly as uploaded, so other formats (MKV, HEVC/H.265) will not play.
            Streams at one fixed quality with no conversion wait.
          </p>
          {r2Busy && r2Mode === 'file' ? (
            <div style={busyStyle}>{r2Phase} {r2Progress != null && `${r2Progress}%`}</div>
          ) : (
            <input
              type="file"
              accept="video/mp4"
              disabled={r2Busy}
              onChange={(e) => {
                setR2Mode('file');
                if (e.target.files?.[0]) upload4k(e.target.files[0]);
              }}
            />
          )}
        </div>

        <div style={cardStyle}>
          <div style={cardHeadStyle}>
            <span>3 · Upload a pre-made HLS folder</span>
            <span style={pillStyle('#2a2a3d', '#8ec3e6')}>4K · adaptive</span>
          </div>
          <p style={cardTextStyle}>
            Best quality option: you encode the adaptive ladder on your own machine, then select the
            whole folder here. It must contain <b><code>master.m3u8</code></b> plus the quality
            sub-folders. Gives true 4K that adapts to each connection, with no server conversion.
            See <b>Guide → Encode a 4K ladder</b> for the exact command.
          </p>
          {r2Busy && r2Mode === 'ladder' ? (
            <div style={busyStyle}>{r2Phase} {r2Progress != null && `${r2Progress}%`}</div>
          ) : (
            <input
              type="file"
              disabled={r2Busy}
              ref={(el) => {
                if (el) {
                  el.setAttribute('webkitdirectory', '');
                  el.setAttribute('directory', '');
                }
              }}
              onChange={(e) => {
                setR2Mode('ladder');
                if (e.target.files?.length) uploadLadder(e.target.files);
              }}
            />
          )}
        </div>

        <div style={cardStyle}>
          <div style={cardHeadStyle}><span>4 · Import from a link</span></div>
          <p style={cardTextStyle}>
            Paste a <b>direct link to the video file</b> (one that downloads the file itself, ending
            in .mp4/.mkv). The server fetches it — ideal for very large files since nothing uploads
            from your browser. Page links (YouTube, Google Drive, Dropbox) will not work.
          </p>
          <form onSubmit={importVideoFromUrl} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              style={{ ...inputStyle, flex: 1, minWidth: 220, marginBottom: 0 }}
              type="url"
              placeholder="https://example.com/movie.mp4"
              value={importUrl}
              onChange={(e) => setImportUrl(e.target.value)}
            />
            <button className="btn" type="submit" disabled={importing || !importUrl.trim()}>
              {importing ? 'Importing…' : 'Import'}
            </button>
          </form>
        </div>

        <div style={cardStyle}>
          <div style={cardHeadStyle}>
            <span>5 · Convert a 4K source on the server</span>
            <span style={pillStyle('#3d2f1c', '#ffb020')}>Slow</span>
          </div>
          <p style={cardTextStyle}>
            Upload any 4K source and the server builds the adaptive ladder itself. Accepts any
            format, but conversion is <b>slow — often hours for a full film</b>, and the video shows
            as &ldquo;uploading&rdquo; until it finishes. Prefer option 3 when you can.
          </p>
          {r2Busy && r2Mode === 'transcode' ? (
            <div style={busyStyle}>{r2Phase} {r2Progress != null && `${r2Progress}%`}</div>
          ) : (
            <input
              type="file"
              accept="video/*"
              disabled={r2Busy}
              onChange={(e) => {
                setR2Mode('transcode');
                if (e.target.files?.[0]) upload4k(e.target.files[0]);
              }}
            />
          )}
        </div>
      </div>

      {adding && (
        <form onSubmit={addEpisode} style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
          {kind === 'series' && (
            <>
              <div>
                <label style={labelStyle}>Season</label>
                <input
                  style={{ ...inputStyle, width: 80 }}
                  value={season}
                  onChange={(e) => {
                    setSeason(e.target.value);
                    setNumberTouched(false);
                  }}
                />
              </div>
              <div>
                <label style={labelStyle}>Number</label>
                <input
                  style={{ ...inputStyle, width: 80 }}
                  value={number}
                  onChange={(e) => {
                    setNumberTouched(true);
                    setNumber(e.target.value);
                  }}
                />
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
              <td style={tdStyle}>
                {ep.cfStatus}
                <span style={{ opacity: 0.55, fontSize: 11, marginLeft: 6 }}>{providerLabel(ep.videoProvider)}</span>
                {/* Also offered for self-hosted rows and for 'error': a
                    transcode killed by a restart leaves a status nothing
                    else can clear, and without a reset the slot is dead. */}
                {(ep.cfStatus === 'uploading' || ep.cfStatus === 'error') && uploadingId !== ep.id && (
                  <button
                    type="button"
                    onClick={() => resetUpload(ep.id)}
                    title="This upload is not running in this tab. Reset it to upload again."
                    style={{ marginLeft: 8, fontSize: 11, background: 'none', border: '1px solid #666', color: '#ccc', borderRadius: 4, padding: '1px 6px', cursor: 'pointer' }}
                  >
                    Reset
                  </button>
                )}
              </td>
              <td style={tdStyle}>
                {ep.videoProvider === 'r2_hls' || ep.videoProvider === 'r2_file' ? (
                  <span style={{ opacity: 0.6, fontSize: 12 }}>self-hosted on R2</span>
                ) : uploadingId === ep.id ? (
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
