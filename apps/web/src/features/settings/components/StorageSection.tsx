import { useEffect, useState } from 'react';
import { notify } from '@/components/ui/notify';
import { clearLocalCache, formatBytes, storageUsage } from '../storage';
import { StoragePerChat } from '@/features/platform/StoragePerChat';
import { useSetting } from '../useSettingsStore';
import { ActionButton, Card, ToggleRow } from './controls';

export const StorageSection = () => {
  const [saveDrafts, setSaveDrafts] = useSetting('saveDrafts');
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null | undefined>(
    undefined,
  );

  const refresh = (): void => {
    void storageUsage().then(setUsage);
  };
  useEffect(refresh, []);

  const clear = async (): Promise<void> => {
    await clearLocalCache();
    notify.success('Local cache cleared. Messages waiting to send were kept.');
    refresh();
  };

  return (
    <Card title="Storage and data">
      <div className="min-h-[44px] py-1">
        <p className="font-semibold">Used on this device</p>
        <p className="text-sm text-base-content/60" data-testid="storage-usage">
          {usage === undefined
            ? 'Checking...'
            : usage === null
              ? 'Your browser does not say.'
              : `${formatBytes(usage.usage)} of ${formatBytes(usage.quota)} available`}
        </p>
      </div>
      <StoragePerChat />
      <div className="flex min-h-[44px] items-center justify-between gap-4 py-1">
        <span>
          <span className="block font-semibold">Clear local cache</span>
          <span className="block text-sm text-base-content/60">
            Removes saved copies and unsent drafts. Messages waiting to send stay.
          </span>
        </span>
        <ActionButton onClick={() => void clear()}>Clear</ActionButton>
      </div>
      <ToggleRow
        label="Keep drafts on this device"
        hint="Unsent text survives a reload. Off: drafts live only while the page is open."
        checked={saveDrafts}
        onChange={setSaveDrafts}
      />
    </Card>
  );
};
