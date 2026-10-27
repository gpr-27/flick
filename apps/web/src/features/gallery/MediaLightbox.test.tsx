import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MediaLightbox } from './MediaLightbox';
import type { GalleryItem } from './gallery';

vi.mock('@/features/chat/content/attachments', () => ({
  useAttachmentUrl: (id: string) => ({ url: `blob:${id}`, failed: false }),
  getAttachmentUrl: vi.fn(),
}));

const items: GalleryItem[] = [
  { attachmentId: 'a', kind: 'image', messageId: 'm1' },
  { attachmentId: 'b', kind: 'image', messageId: 'm2', caption: 'second' },
  { attachmentId: 'c', kind: 'video', messageId: 'm3' },
];

const Harness = ({ onForward }: { onForward?: (id: string) => void }) => {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <main id="app">
        <button
          onClick={() => {
            setOpen('b');
          }}
        >
          tile
        </button>
      </main>
      <MediaLightbox
        items={items}
        startId={open}
        onClose={() => {
          setOpen(null);
        }}
        {...(onForward ? { onForward } : {})}
      />
    </div>
  );
};

const open = async () => {
  const user = userEvent.setup();
  const view = render(<Harness />);
  await user.click(screen.getByText('tile'));
  return { user, view };
};

describe('MediaLightbox', () => {
  it('opens at the tapped item with a counter, above the page, and makes the page inert', async () => {
    const { view } = await open();
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Media viewer' }).parentElement).toBe(document.body);
    expect(view.container.hasAttribute('inert')).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('closes with the Close button and restores the page and focus', async () => {
    const { user, view } = await open();
    await user.click(screen.getByRole('button', { name: 'Close media viewer' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(view.container.hasAttribute('inert')).toBe(false);
    expect(screen.getByText('tile')).toHaveFocus();
  });

  it('closes with the Back button', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('closes with Escape', async () => {
    const { user } = await open();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('closes when the dark backdrop is tapped, but not when the photo is', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('img'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByTestId('media-viewer-backdrop'));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('the browser Back button closes the viewer and stays on the page', async () => {
    const marker = (): string | undefined =>
      (window.history.state as { __flickBack?: string } | null)?.__flickBack;
    await open();
    const opened = marker();
    expect(opened).toBeTruthy();
    window.history.back();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(marker()).not.toBe(opened);
    expect(window.location.pathname).toBe('/');
  });

  it('keeps arrows and keyboard navigation', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('3 of 3')).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

  it('offers Forward for the item on screen when asked to', async () => {
    const onForward = vi.fn();
    const user = userEvent.setup();
    render(<Harness onForward={onForward} />);
    await user.click(screen.getByText('tile'));
    await user.click(screen.getByRole('button', { name: 'Forward' }));
    expect(onForward).toHaveBeenCalledWith('m2');
  });
});
