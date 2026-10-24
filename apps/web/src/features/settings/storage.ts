// What Flick keeps on this device, and how to clear the part that is safe to clear.
import { useDraftStore } from '@/features/organise/drafts';

export const formatBytes = (n: number): string => {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
};

/** How much space this site uses and may use, or null where the browser cannot say. */
export async function storageUsage(): Promise<{ usage: number; quota: number } | null> {
  try {
    // Some browsers have no storage manager.
    const manager = navigator.storage as StorageManager | undefined;
    const estimate = await manager?.estimate();
    if (!estimate || estimate.usage === undefined || estimate.quota === undefined) return null;
    return { usage: estimate.usage, quota: estimate.quota };
  } catch {
    return null;
  }
}

/**
 * Clears copies that can be fetched again: the browser's Cache Storage (except the app shell
 * that makes Flick open offline) and drafts you have not sent. Messages waiting in the outbox
 * are NOT touched, so nothing you wrote is lost. Returns how many caches were removed.
 */
export async function clearLocalCache(): Promise<number> {
  let removed = 0;
  if (typeof caches !== 'undefined') {
    for (const name of await caches.keys()) {
      if (name.includes('precache')) continue; // the app shell
      if (await caches.delete(name)) removed += 1;
    }
  }
  useDraftStore.setState({ drafts: {} });
  try {
    localStorage.removeItem('flick:drafts');
  } catch {
    // storage blocked: nothing was saved there
  }
  return removed;
}
