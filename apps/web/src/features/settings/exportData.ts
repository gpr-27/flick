// "Download my data": GET /users/me/export answers with a JSON file (Content-Disposition:
// attachment). The API client parses JSON bodies, so this one call uses fetch directly with the
// same headers, and hands the file to the browser as a download.
import { ENDPOINTS, buildPath } from '@chat/contracts';
import { config } from '@/config/env';
import { getDeviceId, getSessionToken } from '@/features/auth/authBridge';

const FALLBACK_NAME = 'flick-export.json';

/** The file name the server suggested, or a plain default. */
export const exportFileName = (contentDisposition: string | null): string =>
  /filename="([^"]+)"/.exec(contentDisposition ?? '')?.[1] ?? FALLBACK_NAME;

/** Saves a blob through a temporary link. */
export const saveBlob = (blob: Blob, name: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
};

export async function downloadMyData(
  save: (blob: Blob, name: string) => void = saveBlob,
): Promise<void> {
  const token = await getSessionToken();
  const res = await fetch(buildPath(config.apiUrl, ENDPOINTS.users.export.path), {
    headers: {
      ...config.http.tunnelHeaders,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Device-Id': getDeviceId(),
    },
  });
  if (!res.ok) throw new Error(`Export failed (${String(res.status)})`);
  save(await res.blob(), exportFileName(res.headers.get('content-disposition')));
}
