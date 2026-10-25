// The one place client-only preferences live. Saved in localStorage under `flick.settings.v1`;
// the number in the key changes only if the shape changes incompatibly; `version` counts smaller
// steps (`migrate` turns an older saved value into the current one). Whatever is read back goes through
// sanitizeSettings, so a damaged value falls back to its default instead of breaking the app.
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from './settingsSchema';

export const SETTINGS_KEY = 'flick.settings.v1';
// Version 2: the default text size became small and the default font serif. A saved value that is
// still the OLD default (normal / rounded) moves to the new one; anything else the user chose stays.
export const SETTINGS_VERSION = 2;

/** Before this store, the theme and the message sound had a key each. Used once, on first run. */
const readLegacy = (): Partial<Settings> => {
  const legacy: Partial<Settings> = {};
  try {
    const theme = localStorage.getItem('chat-theme');
    if (theme === 'light' || theme === 'dark') legacy.theme = theme;
    const sound = (
      JSON.parse(localStorage.getItem('flick-notification-prefs') ?? 'null') as {
        sound?: unknown;
      } | null
    )?.sound;
    if (typeof sound === 'boolean') legacy.messageSound = sound;
  } catch {
    // storage blocked or corrupt: the defaults are fine
  }
  return legacy;
};

interface SettingsState extends Settings {
  /** Change one or more settings. */
  update: (patch: Partial<Settings>) => void;
  /** Back to the defaults. */
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...sanitizeSettings({ ...DEFAULT_SETTINGS, ...readLegacy() }),
      update: (patch) => {
        set(sanitizePatch(patch));
      },
      reset: () => {
        set({ ...DEFAULT_SETTINGS });
      },
    }),
    {
      name: SETTINGS_KEY,
      version: SETTINGS_VERSION,
      storage: createJSONStorage(() => localStorage),
      // Only the data is saved, not the functions.
      partialize: (state): Settings => sanitizeSettings(state),
      migrate: (saved, version) => {
        const old = (typeof saved === 'object' && saved !== null ? saved : {}) as Partial<Settings>;
        if (version < 2) {
          if (old.fontSize === 'normal') old.fontSize = 'small';
          if (old.fontFamily === 'rounded') old.fontFamily = 'serif';
        }
        return sanitizeSettings(old);
      },
      // Nothing saved yet (first run): keep what the store started with.
      merge: (saved, current) =>
        typeof saved === 'object' && saved !== null
          ? { ...current, ...sanitizeSettings(saved) }
          : current,
    },
  ),
);

/** A patch with a bad value (wrong type, out of range) is ignored for that key. */
function sanitizePatch(patch: Partial<Settings>): Partial<Settings> {
  const checked = sanitizeSettings({ ...DEFAULT_SETTINGS, ...patch });
  const result: Partial<Settings> = {};
  for (const key of Object.keys(patch) as (keyof Settings)[]) {
    // A value that survived the check is equal to what was passed in.
    if (checked[key] === patch[key]) (result as Record<string, unknown>)[key] = patch[key];
  }
  return result;
}

/** One setting as `[value, setValue]`, for the controls in Settings. */
export function useSetting<K extends keyof Settings>(
  key: K,
): [Settings[K], (v: Settings[K]) => void] {
  const value = useSettingsStore((s) => s[key]);
  const update = useSettingsStore((s) => s.update);
  return [
    value,
    (next) => {
      update({ [key]: next });
    },
  ];
}
