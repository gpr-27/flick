// Settings > Storage: how much media each chat holds on the server, and "Free up space", which
// clears the copies kept on this device (they are fetched again when needed).
import { useEffect, useState } from 'react';
import { ENDPOINTS, type MediaUsage } from '@chat/contracts';
import type { z } from 'zod';
import { notify } from '@/components/ui/notify';
import { ActionButton } from '@/features/settings/components/controls';
import { clearLocalCache, formatBytes } from '@/features/settings/storage';
import { getApi } from '@/lib/services';
import { clearCachedChats } from './offlineCache';

export const StoragePerChat = () => {
  const [usage, setUsage] = useState<z.infer<typeof MediaUsage> | null>(null);
  useEffect(() => {
    Promise.resolve()
      .then(() => getApi().call(ENDPOINTS.platform.mediaUsage))
      .then(
        (r: z.infer<typeof MediaUsage> | undefined) => {
          if (Array.isArray(r?.items)) setUsage(r);
        },
        () => undefined,
      );
  }, []);

  const free = async (): Promise<void> => {
    await clearLocalCache();
    await clearCachedChats();
    notify.success('Freed up space on this device.');
  };

  return (
    <div className="py-1">
      <div className="flex min-h-[44px] items-center justify-between gap-4">
        <span>
          <span className="block font-semibold">Media by chat</span>
          <span className="block text-sm text-base-content/60">
            {usage ? `${formatBytes(usage.total_bytes)} in total` : 'Loading...'}
          </span>
        </span>
        <ActionButton onClick={() => void free()}>Free up space</ActionButton>
      </div>
      <ul className="mt-1 space-y-1 text-sm">
        {usage?.items.slice(0, 10).map((i) => (
          <li key={i.conversation_id} className="flex justify-between gap-3">
            <span className="truncate">{i.name}</span>
            <span className="shrink-0 text-base-content/60">
              {i.files} {i.files === 1 ? 'file' : 'files'}, {formatBytes(i.bytes)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
