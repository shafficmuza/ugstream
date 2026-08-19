'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { tableStyle, thStyle, tdStyle } from '../shared';
import { DiskUsage } from '@/components/disk-usage';

interface MediaFile {
  name: string;
  sizeBytes: number;
  modifiedAt: string;
  url: string;
}

function humanSize(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

export default function AdminMediaPage() {
  const [files, setFiles] = useState<MediaFile[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    const token = getAccessToken();
    if (!token) return;
    apiFetch<{ files: MediaFile[] }>('/admin/media-library', { token })
      .then((r) => setFiles(r.files))
      .catch((e) => setError(e.message ?? 'Could not load uploads.'));
  }

  useEffect(load, []);

  async function copyUrl(f: MediaFile) {
    try {
      await navigator.clipboard.writeText(f.url);
    } catch {
      // Clipboard blocked (non-HTTPS or permission) — fall back to a prompt
      // so the URL can still be copied manually.
      window.prompt('Copy this URL:', f.url);
    }
    setCopied(f.name);
    setTimeout(() => setCopied(null), 1600);
  }

  async function remove(f: MediaFile) {
    if (!confirm(`Delete "${f.name}" from the upload folder?\n\nThis only removes the uploaded file — titles already imported from it keep working.`)) return;
    const token = getAccessToken();
    if (!token) return;
    setError(null);
    try {
      await apiFetch(`/admin/media-library/${encodeURIComponent(f.name)}`, { method: 'DELETE', token });
      load();
    } catch (e: any) {
      setError(e.message ?? 'Delete failed.');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <h1 style={{ fontSize: 22 }}>Uploads</h1>
        <button className="btn" onClick={load}>Refresh</button>
      </div>
      <p style={{ opacity: 0.65, fontSize: 13, marginBottom: 20, maxWidth: 680, lineHeight: 1.6 }}>
        Files uploaded over SFTP appear here about a minute after the transfer finishes. Copy a
        file&apos;s link, then paste it into <b>Import from a link</b> on a title&apos;s edit page —
        the server fetches it directly, so there is no browser upload and no timeout.
      </p>

      <DiskUsage />

      {error && <p style={{ color: '#ff6b6b', marginBottom: 12 }}>{error}</p>}

      {!files ? (
        <p>Loading…</p>
      ) : files.length === 0 ? (
        <div style={{ border: '1px dashed #333', borderRadius: 8, padding: 24, textAlign: 'center', opacity: 0.7 }}>
          <p style={{ marginBottom: 6 }}>No uploads yet.</p>
          <p style={{ fontSize: 13 }}>
            Connect with <b>SFTP</b> to <code>ham.sentepos.com</code> as <code>muzaupload</code> and
            drop files into <code>incoming/</code>.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>File</th>
                <th style={thStyle}>Size</th>
                <th style={thStyle}>Uploaded</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.name}>
                  <td style={{ ...tdStyle, wordBreak: 'break-all' }}>
                    {f.name}
                    <div style={{ fontSize: 11, opacity: 0.45, marginTop: 2 }}>{f.url}</div>
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{humanSize(f.sizeBytes)}</td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    {new Date(f.modifiedAt).toLocaleString()}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    <button
                      className="btn"
                      style={{ padding: '4px 10px', fontSize: 12, marginRight: 8 }}
                      onClick={() => copyUrl(f)}
                    >
                      {copied === f.name ? 'Copied ✓' : 'Copy link'}
                    </button>
                    <button
                      onClick={() => remove(f)}
                      style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: 13 }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
