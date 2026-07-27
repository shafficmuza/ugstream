import { getAccessToken } from '@/lib/auth';

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4001/v1';

export const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  opacity: 0.7,
  marginBottom: 6,
};

export const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '10px 12px',
  marginBottom: 16,
  borderRadius: 4,
  border: '1px solid #333',
  background: '#17171c',
  color: 'white',
};

export const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 14,
};

export const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  borderBottom: '1px solid #333',
  opacity: 0.7,
  fontWeight: 500,
};

export const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #222',
};

/** Multipart upload helper — apiFetch always JSON-encodes, so file uploads go direct. */
export async function uploadFile(path: string, file: File): Promise<any> {
  const token = getAccessToken();
  if (!token) throw new Error('Not logged in.');
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message ?? 'Upload failed.');
  return json;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const token = getAccessToken();
  if (!token) throw new Error('Not logged in.');
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message ?? 'Request failed.');
  return json as T;
}

/** PUT one part to its presigned R2 URL, resolving the part's ETag. */
function putPart(url: string, chunk: Blob, onChunkProgress: (loaded: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => onChunkProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag');
        if (!etag) return reject(new Error('R2 did not return an ETag (check bucket CORS ExposeHeaders).'));
        resolve(etag);
      } else {
        reject(new Error(`Part upload failed (HTTP ${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error uploading part. Check R2 CORS allows PUT.'));
    xhr.send(chunk);
  });
}

/**
 * Upload a (potentially very large) file straight from the browser to R2 in
 * parts via presigned URLs — bytes never touch our server, and there's no
 * single-PUT size ceiling. `purpose` = 'final' for a ready-to-serve file,
 * 'source' for a transcode input. Returns the R2 object key.
 */
export async function uploadToR2(
  file: File,
  purpose: 'source' | 'final',
  onProgress: (pct: number) => void,
): Promise<string> {
  const PART = 100 * 1024 * 1024; // 100MB parts → up to ~1TB, well within R2's 10k-part limit
  const { key, uploadId } = await apiPost<{ key: string; uploadId: string }>(
    '/admin/r2/multipart/create',
    { filename: file.name, contentType: file.type || 'application/octet-stream', purpose },
  );

  try {
    const partCount = Math.max(1, Math.ceil(file.size / PART));
    const parts: { PartNumber: number; ETag: string }[] = [];
    let uploadedBefore = 0;

    for (let i = 0; i < partCount; i++) {
      const start = i * PART;
      const chunk = file.slice(start, Math.min(start + PART, file.size));
      const { url } = await apiPost<{ url: string }>('/admin/r2/multipart/sign-part', {
        key,
        uploadId,
        partNumber: i + 1,
      });
      const etag = await putPart(url, chunk, (loaded) => {
        onProgress(Math.round(((uploadedBefore + loaded) / file.size) * 100));
      });
      parts.push({ PartNumber: i + 1, ETag: etag });
      uploadedBefore += chunk.size;
      onProgress(Math.round((uploadedBefore / file.size) * 100));
    }

    await apiPost('/admin/r2/multipart/complete', { key, uploadId, parts });
    return key;
  } catch (err) {
    await apiPost('/admin/r2/multipart/abort', { key, uploadId }).catch(() => undefined);
    throw err;
  }
}
