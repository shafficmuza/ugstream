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
