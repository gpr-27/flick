// This device's notification choices, in the form the server stores with the subscription
// (the server cannot read the browser's settings, and the worker decides what each push says).
import type { PushPrefs } from '@chat/contracts';
import { useSettingsStore } from '@/features/settings/useSettingsStore';

const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export const currentPrefs = (now = new Date()): PushPrefs => {
  const s = useSettingsStore.getState();
  return {
    previews: s.messagePreviews,
    quiet: s.quietHoursOn
      ? {
          from_min: minutes(s.quietFrom),
          to_min: minutes(s.quietTo),
          offset_min: -now.getTimezoneOffset(),
        }
      : null,
  };
};
