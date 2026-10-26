import { useEffect, useState } from 'react';
import { ENDPOINTS, type WebhookItem } from '@chat/contracts';
import type { z } from 'zod';
import { Button, notify } from '@/components/ui';
import { config } from '@/config/env';
import { getErrorMessage } from '@/lib/api';
import { getApi } from '@/lib/services';

type Hook = z.infer<typeof WebhookItem>;

const hookUrl = (id: string, token: string): string =>
  `${new URL(config.apiUrl, window.location.origin).href.replace(/\/+$/, '')}/hooks/${id}/${token}`;

/**
 * Group info: incoming webhooks. A webhook is a URL; sending {"text": "..."} to it posts that
 * text in this chat as a bot. The secret URL is shown once, right after it is made.
 */
export const WebhooksSection = ({ conversationId }: { conversationId: string }) => {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const params = { conversation_id: conversationId };

  useEffect(() => {
    Promise.resolve()
      .then(() => getApi().call(ENDPOINTS.platform.webhooks, { params }))
      .then(
        (r) => {
          setHooks(r.items);
        },
        () => undefined,
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const create = async (): Promise<void> => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const made = await getApi().call(ENDPOINTS.platform.createWebhook, {
        params,
        body: { name: name.trim() },
      });
      setHooks((h) => [...h, made]);
      setFresh(hookUrl(made.id, made.token));
      setName('');
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't create the webhook."));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (hook: Hook): Promise<void> => {
    try {
      await getApi().call(ENDPOINTS.platform.revokeWebhook, {
        params: { ...params, webhook_id: hook.id },
      });
      setHooks((h) => h.filter((x) => x.id !== hook.id));
    } catch (e) {
      notify.error(getErrorMessage(e, "Couldn't revoke the webhook."));
    }
  };

  return (
    <section aria-labelledby="webhooks-title" className="mt-4">
      <h3 id="webhooks-title" className="text-sm font-semibold">
        Webhooks
      </h3>
      <p className="text-xs text-base-content/60">
        Let a script or service post into this chat. Send a POST with {'{"text": "hello"}'}.
      </p>
      <ul className="mt-1">
        {hooks.map((h) => (
          <li key={h.id} className="flex min-h-[44px] items-center justify-between gap-2">
            <span className="truncate">{h.name}</span>
            <Button variant="ghost" onClick={() => void revoke(h)}>
              <span className="sr-only">Revoke {h.name}</span>
              <span aria-hidden="true">Revoke</span>
            </Button>
          </li>
        ))}
      </ul>
      {fresh && (
        <div role="status" className="rounded-2xl bg-base-200 p-3 text-xs">
          <p className="font-semibold">Copy this URL now. It will not be shown again.</p>
          <code className="block break-all">{fresh}</code>
          <button
            type="button"
            className="btn btn-outline btn-sm mt-2 min-h-[44px] rounded-2xl"
            onClick={() => {
              void navigator.clipboard.writeText(fresh).then(() => {
                notify.success('Copied.');
              });
            }}
          >
            Copy URL
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm mt-2 min-h-[44px] rounded-2xl"
            onClick={() => {
              setFresh(null);
            }}
          >
            Done
          </button>
        </div>
      )}
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input
          className="input-soft min-h-[44px] flex-1"
          aria-label="Webhook name"
          placeholder="Name, e.g. Deploys"
          maxLength={40}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <button type="submit" disabled={busy} className="btn btn-outline min-h-[44px] rounded-2xl">
          Create
        </button>
      </form>
    </section>
  );
};
