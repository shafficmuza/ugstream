'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { inputStyle, labelStyle } from '../../../shared';

interface TmdbResult {
  tmdbId: number;
  name: string;
  year: string | null;
  overview: string | null;
  previewUrl: string;
  posterPath: string | null;
  backdropPath: string | null;
}

/**
 * Artwork tools for a title. Two sources:
 *  - TMDB, for official studio posters/backdrops (the usual choice)
 *  - frames from the title's own video, for local content TMDB won't have
 * Both require a human to pick, since fuzzy title matching goes wrong quietly.
 */
export function ArtworkPanel({
  titleId,
  titleName,
  kind,
  year,
  onApplied,
}: {
  titleId: string;
  titleName: string;
  kind: string;
  year?: string;
  onApplied: () => void;
}) {
  const [query, setQuery] = useState(titleName);
  const [results, setResults] = useState<TmdbResult[] | null>(null);
  const [frames, setFrames] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function searchTmdb() {
    const token = getAccessToken();
    if (!token) return;
    setBusy('search');
    setMsg(null);
    setFrames(null);
    try {
      const r = await apiFetch<{ results: TmdbResult[] }>(
        `/admin/titles/${titleId}/artwork/tmdb-search`,
        { method: 'POST', token, body: { query, kind, year: year ? parseInt(year, 10) : undefined } },
      );
      setResults(r.results);
      if (r.results.length === 0) {
        setMsg('No match on TMDB. For local content, use “Use a frame from the video” below.');
      }
    } catch (e: any) {
      setMsg(e.message ?? 'Search failed.');
    } finally {
      setBusy(null);
    }
  }

  async function applyTmdb(r: TmdbResult) {
    const token = getAccessToken();
    if (!token) return;
    setBusy(`apply-${r.tmdbId}`);
    setMsg(null);
    try {
      await apiFetch(`/admin/titles/${titleId}/artwork/tmdb-apply`, {
        method: 'POST',
        token,
        body: { posterPath: r.posterPath, backdropPath: r.backdropPath },
      });
      setMsg(`Applied official artwork from “${r.name}”.`);
      setResults(null);
      onApplied();
    } catch (e: any) {
      setMsg(e.message ?? 'Could not apply artwork.');
    } finally {
      setBusy(null);
    }
  }

  async function generateFrames() {
    const token = getAccessToken();
    if (!token) return;
    setBusy('frames');
    setMsg(null);
    setResults(null);
    try {
      const r = await apiFetch<{ candidates: string[] }>(
        `/admin/titles/${titleId}/artwork/candidates`,
        { method: 'POST', token },
      );
      setFrames(r.candidates);
    } catch (e: any) {
      setMsg(e.message ?? 'Could not read frames from the video.');
    } finally {
      setBusy(null);
    }
  }

  async function applyFrame(candidate: string) {
    const token = getAccessToken();
    if (!token) return;
    setBusy(`frame-${candidate}`);
    setMsg(null);
    try {
      await apiFetch(`/admin/titles/${titleId}/artwork/apply`, {
        method: 'POST',
        token,
        body: { candidate },
      });
      setMsg('Poster and banner created from that frame.');
      setFrames(null);
      onApplied();
    } catch (e: any) {
      setMsg(e.message ?? 'Could not apply that frame.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ border: '1px solid #2a2a2a', borderRadius: 8, padding: '14px 16px', background: '#111', marginTop: 20 }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Artwork</div>
      <p style={{ opacity: 0.7, fontSize: 13, lineHeight: 1.55, marginBottom: 12 }}>
        Fetch the <b>official poster and banner</b> by searching the film database, or fall back to
        a frame from the video for local content that isn&apos;t listed.
      </p>

      <label style={labelStyle}>Film title to search for</label>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          style={{ ...inputStyle, flex: 1, minWidth: 220, marginBottom: 0 }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && searchTmdb()}
          placeholder="e.g. On the Hunt"
        />
        <button className="btn" onClick={searchTmdb} disabled={busy === 'search'}>
          {busy === 'search' ? 'Searching…' : 'Find official artwork'}
        </button>
      </div>
      <p style={{ opacity: 0.5, fontSize: 12, marginTop: 6 }}>
        Tip: search the <b>original film title</b>, not the VJ/translated name — that&apos;s what the
        database is indexed by.
      </p>

      {msg && <p style={{ marginTop: 10, fontSize: 13, color: '#8ec3e6' }}>{msg}</p>}

      {results && results.length > 0 && (
        <>
          <p style={{ fontSize: 13, opacity: 0.75, marginTop: 14, marginBottom: 8 }}>
            Pick the correct film:
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 12 }}>
            {results.map((r) => (
              <button
                key={r.tmdbId}
                onClick={() => applyTmdb(r)}
                disabled={busy !== null}
                title={r.overview ?? ''}
                style={{
                  background: 'none', border: '1px solid #333', borderRadius: 6,
                  padding: 0, cursor: 'pointer', overflow: 'hidden', textAlign: 'left',
                }}
              >
                <img src={r.previewUrl} alt={r.name} style={{ width: '100%', display: 'block', aspectRatio: '2/3', objectFit: 'cover' }} />
                <div style={{ padding: '6px 8px', fontSize: 12, color: '#fff' }}>
                  {busy === `apply-${r.tmdbId}` ? 'Applying…' : r.name}
                  <div style={{ opacity: 0.5 }}>{r.year ?? ''}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #222' }}>
        <button className="btn" onClick={generateFrames} disabled={busy === 'frames'}>
          {busy === 'frames' ? 'Reading frames…' : 'Use a frame from the video instead'}
        </button>
        <span style={{ opacity: 0.5, fontSize: 12, marginLeft: 10 }}>
          For local content with no database entry.
        </span>
      </div>

      {frames && frames.length > 0 && (
        <>
          <p style={{ fontSize: 13, opacity: 0.75, marginTop: 14, marginBottom: 8 }}>
            Pick a frame — it becomes both the poster (2:3) and banner (16:9):
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            {frames.map((f) => (
              <button
                key={f}
                onClick={() => applyFrame(f)}
                disabled={busy !== null}
                style={{
                  background: 'none', border: '1px solid #333', borderRadius: 6,
                  padding: 0, cursor: 'pointer', overflow: 'hidden',
                }}
              >
                <img src={f} alt="" style={{ width: '100%', display: 'block' }} />
                {busy === `frame-${f}` && (
                  <div style={{ fontSize: 12, padding: 6, color: '#8ec3e6' }}>Applying…</div>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      <p style={{ opacity: 0.35, fontSize: 11, marginTop: 16 }}>
        Official artwork via TMDB. This product uses the TMDB API but is not endorsed or certified
        by TMDB.
      </p>
    </div>
  );
}
