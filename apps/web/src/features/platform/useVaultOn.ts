import { useSettingsStore } from '@/features/settings/useSettingsStore';

/** Locked chats move to the vault only while an app-lock PIN is set. */
export const useVaultOn = (): boolean => useSettingsStore((s) => s.screenLockHash !== null);
