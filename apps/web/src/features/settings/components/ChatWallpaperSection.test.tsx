import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryKv } from '@/lib/idb';
import { useChatStore } from '../../chat/useChatStore';
import { configureWallpaperStorage, resetCustomWallpapers } from '../../organise/customWallpapers';
import { installFakeServices, makeConversation } from '../../../../test/fakes';
import { useSettingsStore } from '../useSettingsStore';
import { ChatWallpaperSection } from './ChatWallpaperSection';

const withOwn = (id: string, wallpaper: string | null) => {
  const base = makeConversation({ id });
  return { ...base, prefs: { ...base.prefs, wallpaper } };
};

beforeEach(() => {
  installFakeServices();
  configureWallpaperStorage(createMemoryKv());
  resetCustomWallpapers();
  useSettingsStore.getState().reset();
  useChatStore.getState().reset();
  useChatStore.setState({
    conversations: {
      a: withOwn('a', 'mint'),
      b: withOwn('b', null),
      c: withOwn('c', 'night'),
    },
  });
});

describe('ChatWallpaperSection', () => {
  it('a pick only changes the global wallpaper and leaves chats alone', async () => {
    const user = userEvent.setup();
    const clearOne = vi.fn((_id: string) => Promise.resolve());
    render(<ChatWallpaperSection clearOne={clearOne} />);
    await user.click(screen.getByRole('button', { name: 'Sunset' }));
    await user.click(screen.getByRole('button', { name: 'Use for chats without their own' }));
    expect(useSettingsStore.getState().defaultWallpaper).toBe('sunset');
    expect(clearOne).not.toHaveBeenCalled();
  });

  it('Apply to every chat confirms with the count, then resets only chats with an override', async () => {
    const user = userEvent.setup();
    const clearOne = vi.fn((_id: string) => Promise.resolve());
    render(<ChatWallpaperSection clearOne={clearOne} />);
    await user.click(screen.getByRole('button', { name: 'Sunset' }));
    await user.click(screen.getByRole('button', { name: 'Apply to every chat' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('2 chats have their own wallpaper');
    await user.click(within(dialog).getByRole('button', { name: 'Apply to every chat' }));
    await waitFor(() => {
      expect(clearOne).toHaveBeenCalledTimes(2);
    });
    expect(clearOne.mock.calls.map((c) => c[0]).sort()).toEqual(['a', 'c']);
    expect(useSettingsStore.getState().defaultWallpaper).toBe('sunset');
    expect(await screen.findByText(/Every chat shows this wallpaper/)).toBeInTheDocument();
  });

  it('reports chats that could not be reset', async () => {
    const user = userEvent.setup();
    const clearOne = vi.fn((id: string) =>
      id === 'a' ? Promise.reject(new Error('nope')) : Promise.resolve(),
    );
    render(<ChatWallpaperSection clearOne={clearOne} />);
    await user.click(screen.getByRole('button', { name: 'Apply to every chat' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Apply to every chat' }));
    expect(await screen.findByText(/1 reset, 1 could not be reset/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('Remove wallpaper from all chats sets None and resets overrides', async () => {
    const user = userEvent.setup();
    useSettingsStore.getState().update({ defaultWallpaper: 'mint' });
    const clearOne = vi.fn((_id: string) => Promise.resolve());
    render(<ChatWallpaperSection clearOne={clearOne} />);
    await user.click(screen.getByRole('button', { name: 'Remove wallpaper from all chats' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove from all' }));
    await waitFor(() => {
      expect(clearOne).toHaveBeenCalledTimes(2);
    });
    expect(useSettingsStore.getState().defaultWallpaper).toBeNull();
  });

  it('notes a custom global wallpaper that is on another device', async () => {
    useSettingsStore.getState().update({ defaultWallpaper: 'custom:elsewhere' });
    render(<ChatWallpaperSection />);
    expect(
      await screen.findByText(/stored on another device/, { selector: 'p[role=status]' }),
    ).toBeInTheDocument();
  });
});
