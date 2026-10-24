// Attachments are private: a short-lived presigned URL is requested from the API when needed.
import { useCallback, useEffect, useState } from 'react';
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

/** Forget the cached link and ask for a fresh one (the old signed link expired or failed). */
export const refreshAttachmentUrl = (attachmentId: string): Promise<string> => {
  cache.delete(attachmentId);
  return getAttachmentUrl(attachmentId);
};

export interface AttachmentUrl {
  url: string | null;
  failed: boolean;
  /** Call from the element's onError: the signed link no longer works, show the error state. */
  fail: () => void;
  /** Fetch a fresh signed link (the "Reload" button). */
  reload: () => void;
}

/** The download URL of an attachment, or null while loading / if it failed. */
export const useAttachmentUrl = (attachmentId: string): AttachmentUrl => {
  const [state, setState] = useState<{ id: string; url: string | null; failed: boolean }>({
    id: attachmentId,
    url: null,
    failed: false,
  });
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let alive = true;
    // The first load may use the cache; a reload (tries > 0) always asks for a new link.
    (tries > 0 ? refreshAttachmentUrl(attachmentId) : getAttachmentUrl(attachmentId))
      .then((url) => {
        if (alive) setState({ id: attachmentId, url, failed: false });
      })
      .catch(() => {
        if (alive) setState({ id: attachmentId, url: null, failed: true });
      });
    return () => {
      alive = false;
    };
  }, [attachmentId, tries]);
  const fail = useCallback((): void => {
    setState({ id: attachmentId, url: null, failed: true });
  }, [attachmentId]);
  const reload = useCallback((): void => {
    setState({ id: attachmentId, url: null, failed: false });
    setTries((n) => n + 1);
  }, [attachmentId]);
  const current = state.id === attachmentId ? state : { url: null, failed: false };
  return { ...current, fail, reload };
};
