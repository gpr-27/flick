// Wallpaper lookup, the custom (gallery) store and the picker.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryKv } from '@/lib/idb';
import { useSettingsStore } from '../settings/useSettingsStore';
import {
  MAX_CUSTOM_WALLPAPERS,
  configureWallpaperStorage,
  resetCustomWallpapers,
  useCustomWallpapers,
} from './customWallpapers';
import { useWallpaper } from './useWallpaper';
import { WallpaperPicker } from './WallpaperPicker';
import { CATEGORIES, WALLPAPERS, findWallpaper, wallpaperStyle } from './wallpapers';

vi.mock('../profile/decodeImage', () => ({
  looksLikeImage: (f: File) => f.type.startsWith('image/'),
  decodeImage: () => {
    const c = document.createElement('canvas');
    c.width = 10;
    c.height = 10;
    c.toBlob = (cb: BlobCallback) => {
      cb(new Blob(['x'], { type: 'image/webp' }));
    };
    return Promise.resolve(c);
  },
}));

let counter = 0;
beforeEach(() => {
  configureWallpaperStorage(createMemoryKv());
  resetCustomWallpapers();
  useSettingsStore.getState().reset();
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: () => `blob:test/${String(++counter)}`,
      revokeObjectURL: () => undefined,
    }),
  );
});

const picture = (name = 'a.png'): File => new File(['x'], name, { type: 'image/png' });

describe('built-in wallpapers', () => {
  it('has 30+ with unique ids, each in a known category', () => {
    expect(WALLPAPERS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(WALLPAPERS.map((w) => w.id)).size).toBe(WALLPAPERS.length);
    const cats = new Set(CATEGORIES.map((c) => c.id));
    for (const w of WALLPAPERS) expect(cats.has(w.category)).toBe(true);
  });

  it('keeps the original eight ids', () => {
    for (const id of ['sand', 'mint', 'sky', 'rose', 'night', 'dots', 'grid', 'waves']) {
      expect(wallpaperStyle(id)).not.toBeNull();
    }
  });

  it('falls back to null for unknown, custom and empty ids', () => {
    expect(wallpaperStyle('nope')).toBeNull();
    expect(wallpaperStyle('custom:abc')).toBeNull();
    expect(wallpaperStyle(null)).toBeNull();
    expect(findWallpaper('')).toBeNull();
  });
});

describe('custom wallpaper store', () => {
  it('adds, lists and removes pictures', async () => {
    const id = await useCustomWallpapers.getState().add(picture());
    expect(id).toMatch(/^custom:/);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(useCustomWallpapers.getState().items).toHaveLength(1);
    await useCustomWallpapers.getState().remove(id);
    expect(useCustomWallpapers.getState().items).toHaveLength(0);
  });

  it('reloads from storage', async () => {
    const id = await useCustomWallpapers.getState().add(picture());
    useCustomWallpapers.setState({ items: [], loaded: false });
    await useCustomWallpapers.getState().load();
    expect(useCustomWallpapers.getState().items.map((i) => i.id)).toEqual([id]);
  });

  it('keeps at most the limit', async () => {
    for (let i = 0; i < MAX_CUSTOM_WALLPAPERS; i++)
      await useCustomWallpapers.getState().add(picture());
    await expect(useCustomWallpapers.getState().add(picture())).rejects.toThrow(/up to 10/);
  });

  it('rejects non-pictures', async () => {
    await expect(
      useCustomWallpapers.getState().add(new File(['x'], 'a.txt', { type: 'text/plain' })),
    ).rejects.toThrow(/picture/);
  });

  it('useWallpaper: custom id resolves, a missing one falls back and is flagged', async () => {
    const Probe = ({ id }: { id: string }) => {
      const w = useWallpaper(id);
      return <p>{w.style ? 'styled' : w.missing ? 'missing' : 'none'}</p>;
    };
    const id = await useCustomWallpapers.getState().add(picture());
    const { rerender } = render(<Probe id={id} />);
    expect(screen.getByText('styled')).toBeInTheDocument();
    rerender(<Probe id="custom:gone" />);
    await waitFor(() => {
      expect(screen.getByText('missing')).toBeInTheDocument();
    });
    rerender(<Probe id="unknown-id" />);
    expect(screen.getByText('none')).toBeInTheDocument();
  });
});

describe('WallpaperPicker', () => {
  const mount = (value: string | null = null) => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<WallpaperPicker value={value} onApply={onApply} onCancel={onCancel} />);
    return { user, onApply, onCancel };
  };

  it('previews a pick and applies it only on Apply', async () => {
    const { user, onApply } = mount('mint');
    const group = screen.getByRole('group', { name: 'Wallpapers' });
    expect(within(group).getByRole('button', { name: 'Mint' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(group).getByRole('button', { name: 'Sunset' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(within(group).getByRole('button', { name: 'Sunset' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith('sunset');
  });

  it('Default applies null; Cancel applies nothing', async () => {
    const { user, onApply, onCancel } = mount('mint');
    await user.click(screen.getByRole('button', { name: 'Default' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith(null);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('uploads a picture, selects it, and can remove it', async () => {
    const { user, onApply } = mount();
    await user.upload(screen.getByLabelText('Choose a picture for the wallpaper'), picture());
    const tile = await screen.findByRole('button', { name: 'My picture 1' });
    expect(tile).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith(expect.stringMatching(/^custom:/));
    await user.click(screen.getByRole('button', { name: 'Remove my picture 1' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'My picture 1' })).not.toBeInTheDocument();
    });
  });

  it('explains a custom wallpaper that is not on this device', async () => {
    mount('custom:elsewhere');
    expect(await screen.findByRole('status')).toHaveTextContent(/stored on another device/);
    expect(screen.getByText(/stored on this device only/)).toBeInTheDocument();
  });

  it('the dim slider is saved in settings', () => {
    mount();
    const slider = screen.getByRole('slider', { name: 'Dim wallpaper' });
    fireEvent.change(slider, { target: { value: '30' } });
    expect(useSettingsStore.getState().wallpaperDim).toBe(30);
  });
});
