import { useState } from 'react';
import { Copy, Link as LinkIcon } from 'lucide-react';
import { ENDPOINTS } from '@chat/contracts';
import { Button, notify } from '@/components/ui';
import { getApi } from '@/lib/services';
import { groupCallErrorMessage } from '../errors';
import type { CallLink } from '../types';

import { callLinkUrl } from '../callLinkUrl';

/** Group info: make a call link and copy it. Rendered for admins only (the parent decides). */
export const CallLinkSection = ({ conversationId }: { conversationId: string }) => {
  const [media, setMedia] = useState<CallLink['media']>('video');
  const [link, setLink] = useState<CallLink | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async (): Promise<void> => {
    setBusy(true);
    try {
      setLink(
        await getApi().call(ENDPOINTS.calls.createLink, {
          body: { conversation_id: conversationId, media },
        }),
      );
    } catch (error) {
      notify.error(groupCallErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (): Promise<void> => {
    if (!link) return;
    try {
      await getApi().call(ENDPOINTS.calls.revokeLink, { params: { code: link.code } });
      setLink(null);
      notify.success('Link revoked');
    } catch (error) {
      notify.error(groupCallErrorMessage(error));
    }
  };

  const copy = async (): Promise<void> => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(callLinkUrl(link.code));
      notify.success('Link copied');
    } catch {
      notify.error('Could not copy. Select the link and copy it by hand.');
    }
  };

  return (
    <section className="mt-4" aria-labelledby="call-link-title">
      <h3 id="call-link-title" className="mb-2 text-sm font-semibold text-base-content/60">
        Call link
      </h3>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="call-link-media">
          Call type
        </label>
        <select
          id="call-link-media"
          className="select select-bordered select-sm"
          value={media}
          onChange={(e) => {
            setMedia(e.target.value === 'audio' ? 'audio' : 'video');
          }}
        >
          <option value="video">Video call</option>
          <option value="audio">Voice call</option>
        </select>
        <Button
          variant="dashed"
          loading={busy}
          icon={<LinkIcon className="size-4" aria-hidden="true" />}
          onClick={() => void create()}
        >
          Create link
        </Button>
      </div>
      {link && (
        <div className="mt-3 flex items-center gap-2">
          <input
            readOnly
            aria-label="Call link"
            className="input-soft min-w-0 flex-1 text-sm"
            value={callLinkUrl(link.code)}
            onFocus={(e) => {
              e.currentTarget.select();
            }}
          />
          <button
            type="button"
            className="btn btn-circle btn-ghost btn-sm"
            aria-label="Copy call link"
            onClick={() => void copy()}
          >
            <Copy className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-xs text-error"
            onClick={() => void revoke()}
          >
            Revoke
          </button>
        </div>
      )}
      {link && (
        <p className="mt-1 text-xs text-base-content/60">
          Expires {new Date(link.expires_at).toLocaleString()}. Anyone with the link can join.
        </p>
      )}
    </section>
  );
};
