// Attachments are private: a short-lived presigned URL is requested from the API when needed.
import { useEffect, useState } from 'react';
import { ENDPOINTS } from '@chat/contracts';
import { getApi } from '@/lib/services';

const EXPIRY_MARGIN_MS = 30_000;
const cache = new Map<string, { url: string; expiresAt: number }>();
const pending = new Map<string, Promise<string>>();

export const getAttachmentUrl = (attachmentId: string): Promise<string> => {
  const hit = cache.get(attachmentId);
  if (hit && hit.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return Promise.resolve(hit.url);
  let request = pending.get(attachmentId);
  if (!request) {
    request = getApi()
      .call(ENDPOINTS.media.download, { params: { attachment_id: attachmentId } })
      .then(({ url, expires_at }) => {
        cache.set(attachmentId, { url, expiresAt: Date.parse(expires_at) });
        return url;
      })
      .finally(() => {
        pending.delete(attachmentId);
      });
    pending.set(attachmentId, request);
  }
  return request;
};

/** The download URL of an attachment, or null while loading / if it failed. */
/** Pass `enabled = false` to wait (for example until the person taps "Download"). */
export const useAttachmentUrl = (
  attachmentId: string,
  enabled = true,
): { url: string | null; failed: boolean } => {
  const [state, setState] = useState<{ id: string; url: string | null; failed: boolean }>({
    id: attachmentId,
    url: null,
    failed: false,
  });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    getAttachmentUrl(attachmentId)
      .then((url) => {
        if (alive) setState({ id: attachmentId, url, failed: false });
      })
      .catch(() => {
        if (alive) setState({ id: attachmentId, url: null, failed: true });
      });
    return () => {
      alive = false;
    };
  }, [attachmentId, enabled]);
  return state.id === attachmentId ? state : { url: null, failed: false };
};
