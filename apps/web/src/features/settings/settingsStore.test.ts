import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from './settingsSchema';
import { SETTINGS_KEY, SETTINGS_VERSION, useSettingsStore } from './useSettingsStore';

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.getState().reset();
});

const saved = () =>
  JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as {
    state: Record<string, unknown>;
    version: number;
  } | null;

describe('settings defaults', () => {
  it('start with the documented defaults', () => {
    const s = useSettingsStore.getState();
    expect(s).toMatchObject({
      messageSound: true,
      ringtoneEnabled: true,
      theme: 'system',
      accent: 'violet',
      fontSize: 'small',
      fontFamily: 'serif',
      density: 'comfortable',
      corners: 'rounded',
      enterSends: true,
      showTyping: true,
      linkPreviews: true,
      mediaAutoDownload: 'always',
      defaultDisappearing: 0,
      keepArchived: true,
      cameraOffByDefault: false,
      noiseSuppression: true,
      echoCancellation: true,
      videoQuality: 'auto',
      relayOnly: false,
      screenLockHash: null,
      showModelName: true,
      saveDrafts: true,
      quietHoursOn: false,
    });
  });
});

describe('settings store', () => {
  it('saves under flick.settings.v1 with a version, data only', () => {
    useSettingsStore.getState().update({ fontSize: 'large', accent: 'teal' });
    const stored = saved();
    expect(stored?.version).toBe(SETTINGS_VERSION);
    expect(stored?.state).toMatchObject({ fontSize: 'large', accent: 'teal' });
    expect(Object.values(stored?.state ?? {}).some((v) => typeof v === 'function')).toBe(false);
    expect(SETTINGS_KEY).toBe('flick.settings.v1');
  });

  it('ignores a value that is not allowed and keeps the old one', () => {
    useSettingsStore.getState().update({ fontSize: 'large' });
    useSettingsStore.getState().update({ fontSize: 'gigantic' as never, soundVolume: 7 });
    expect(useSettingsStore.getState().fontSize).toBe('large');
    expect(useSettingsStore.getState().soundVolume).toBe(DEFAULT_SETTINGS.soundVolume);
  });

  it('reset goes back to the defaults', () => {
    useSettingsStore.getState().update({ enterSends: false, relayOnly: true });
    useSettingsStore.getState().reset();
    expect(useSettingsStore.getState().enterSends).toBe(true);
    expect(useSettingsStore.getState().relayOnly).toBe(false);
  });
});

describe('the small / serif defaults', () => {
  it('a saved value that is still the old default moves to the new default, once', async () => {
    localStorage.setItem(
      'flick.settings.v1',
      JSON.stringify({
        version: 1,
        state: { fontSize: 'normal', fontFamily: 'rounded', accent: 'teal' },
      }),
    );
    vi.resetModules();
    const { useSettingsStore: fresh } = await import('./useSettingsStore');
    await fresh.persist.rehydrate();
    expect(fresh.getState()).toMatchObject({
      fontSize: 'small',
      fontFamily: 'serif',
      accent: 'teal',
    });
  });

  it('a size or font the user picked on purpose is kept', async () => {
    localStorage.setItem(
      'flick.settings.v1',
      JSON.stringify({ version: 1, state: { fontSize: 'large', fontFamily: 'mono' } }),
    );
    vi.resetModules();
    const { useSettingsStore: fresh } = await import('./useSettingsStore');
    await fresh.persist.rehydrate();
    expect(fresh.getState()).toMatchObject({ fontSize: 'large', fontFamily: 'mono' });
  });

  it('a value saved by the current version is left alone, even normal / rounded', async () => {
    localStorage.setItem(
      'flick.settings.v1',
      JSON.stringify({ version: 2, state: { fontSize: 'normal', fontFamily: 'rounded' } }),
    );
    vi.resetModules();
    const { useSettingsStore: fresh } = await import('./useSettingsStore');
    await fresh.persist.rehydrate();
    expect(fresh.getState()).toMatchObject({ fontSize: 'normal', fontFamily: 'rounded' });
  });
});

describe('sanitizeSettings (migration of old or damaged data)', () => {
  it('keeps valid values, replaces invalid ones, drops unknown keys', () => {
    const result = sanitizeSettings({
      fontSize: 'xlarge',
      accent: 'purple',
      soundVolume: 2,
      quietFrom: '25:99',
      quietTo: '06:30',
      defaultDisappearing: 604_800,
      screenLockHash: 'not-a-hash',
      somethingRemoved: true,
    });
    expect(result.fontSize).toBe('xlarge');
    expect(result.accent).toBe(DEFAULT_SETTINGS.accent);
    expect(result.soundVolume).toBe(DEFAULT_SETTINGS.soundVolume);
    expect(result.quietFrom).toBe(DEFAULT_SETTINGS.quietFrom);
    expect(result.quietTo).toBe('06:30');
    expect(result.defaultDisappearing).toBe(604_800);
    expect(result.screenLockHash).toBeNull();
    expect('somethingRemoved' in result).toBe(false);
  });

  it('turns anything that is not an object into the defaults', () => {
    for (const bad of [null, undefined, 'x', 5, []]) {
      expect(sanitizeSettings(bad)).toEqual(DEFAULT_SETTINGS);
    }
  });
});

describe('loading from storage', () => {
  const fresh = async () => {
    vi.resetModules();
    return (await import('./useSettingsStore')).useSettingsStore;
  };

  it('reads the saved settings, fixing a damaged value and filling a missing one', async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ version: 1, state: { corners: 'sharp', density: 'huge' } }),
    );
    const store = await fresh();
    expect(store.getState().corners).toBe('sharp');
    expect(store.getState().density).toBe('comfortable');
    expect(store.getState().messageSound).toBe(true);
  });

  it('survives garbage in storage', async () => {
    localStorage.setItem(SETTINGS_KEY, '{not json');
    const store = await fresh();
    expect(store.getState().theme).toBe('system');
  });

  it('migrates a state saved by an older version', async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ version: 0, state: { fontSize: 'small', unknownOldKey: 1 } }),
    );
    const store = await fresh();
    expect(store.getState().fontSize).toBe('small');
    expect('unknownOldKey' in store.getState()).toBe(false);
  });

  it('takes the old theme and sound keys on the very first run', async () => {
    localStorage.setItem('chat-theme', 'dark');
    localStorage.setItem('flick-notification-prefs', JSON.stringify({ sound: false }));
    localStorage.removeItem(SETTINGS_KEY); // a first run has no saved settings yet
    const store = await fresh();
    expect(store.getState().theme).toBe('dark');
    expect(store.getState().messageSound).toBe(false);
  });
});
