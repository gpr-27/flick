import { afterEach, describe, expect, it, vi } from 'vitest';
import { inviteFriends } from './inviteFriends';

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/components/ui/notify', () => ({ notify }));

const setNavigator = (share: unknown, writeText: unknown): void => {
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
};

afterEach(() => {
  vi.clearAllMocks();
  Reflect.deleteProperty(navigator, 'share');
});

describe('inviteFriends', () => {
  it('opens the share sheet with the Flick link when the browser has one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    setNavigator(share, writeText);
    await inviteFriends();
    expect(share).toHaveBeenCalledWith({
      title: 'Flick',
      text: 'Chat with me on Flick',
      url: location.origin,
    });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('does nothing more when the person closes the share sheet', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError'));
    const writeText = vi.fn();
    setNavigator(share, writeText);
    await inviteFriends();
    expect(writeText).not.toHaveBeenCalled();
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('copies the link and shows a toast when there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator(undefined, writeText);
    await inviteFriends();
    expect(writeText).toHaveBeenCalledWith(location.origin);
    expect(notify.success).toHaveBeenCalledOnce();
  });

  it('shows the link in a toast when copying is blocked too', async () => {
    setNavigator(undefined, vi.fn().mockRejectedValue(new Error('denied')));
    await inviteFriends();
    expect(notify.info).toHaveBeenCalledWith(expect.stringContaining(location.origin));
  });
});
