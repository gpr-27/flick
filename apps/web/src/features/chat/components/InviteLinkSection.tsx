import { useState } from 'react';
import { Copy, Link as LinkIcon } from 'lucide-react';
import { ENDPOINTS } from '@chat/contracts';
import { Button, notify } from '@/components/ui';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';
import { inviteUrl } from './inviteUrl';

/**
 * Group info: make a link that lets people join the group, copy it, reset it (the old one stops
 * working) or revoke it. The server stores only a hash of the code, so a link can be shown only
 * while this panel remembers it; after a reload, "Reset link" makes a fresh one.
 */
export const InviteLinkSection = ({ conversationId }: { conversationId: string }) => {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const api = getApi();

  const create = async (): Promise<void> => {
    setBusy(true);
    try {
      // Reset = make the new link first, then revoke the old one, so a failure never leaves
      // the group without a working link.
      const old = code;
      const fresh = await api.call(ENDPOINTS.conversations.createInvite, {
        params: { conversation_id: conversationId },
        body: {},
      });
      setCode(fresh.code);
      if (old) await api.call(ENDPOINTS.conversations.revokeInvite, { params: { code: old } });
    } catch (error) {
      notify.error(getErrorMessage(error, "Couldn't make the invite link."));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (): Promise<void> => {
    if (!code) return;
    try {
      await api.call(ENDPOINTS.conversations.revokeInvite, { params: { code } });
      setCode(null);
      notify.success('Invite link revoked');
    } catch (error) {
      notify.error(getErrorMessage(error, "Couldn't revoke the link."));
    }
  };

  const copy = async (): Promise<void> => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      notify.success('Link copied');
    } catch {
      notify.error('Could not copy. Select the link and copy it by hand.');
    }
  };

  return (
    <section className="mt-4" aria-labelledby="invite-link-title">
      <h3 id="invite-link-title" className="mb-2 text-sm font-semibold text-base-content/60">
        Invite link
      </h3>
      {code ? (
        <>
          <div className="flex items-center gap-2">
            <input
              readOnly
              aria-label="Invite link"
              className="input-soft min-w-0 flex-1 text-sm"
              value={inviteUrl(code)}
              onFocus={(e) => {
                e.currentTarget.select();
              }}
            />
            <button
              type="button"
              className="btn btn-circle btn-ghost btn-sm"
              aria-label="Copy invite link"
              onClick={() => void copy()}
            >
              <Copy className="size-4" aria-hidden="true" />
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              disabled={busy}
              onClick={() => void create()}
            >
              Reset link
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs text-error"
              onClick={() => void revoke()}
            >
              Revoke
            </button>
          </div>
        </>
      ) : (
        <Button
          variant="dashed"
          loading={busy}
          icon={<LinkIcon className="size-4" aria-hidden="true" />}
          onClick={() => void create()}
        >
          Create invite link
        </Button>
      )}
    </section>
  );
};
