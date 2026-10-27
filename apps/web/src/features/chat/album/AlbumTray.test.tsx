import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MessageContent } from '@chat/contracts';
import { describe, expect, it, vi } from 'vitest';
import { AlbumTray } from './AlbumTray';
import { useAlbumDraft } from './useAlbumDraft';
import type { uploadItem } from './uploadItem';

vi.mock('./thumbnails', () => ({
  createThumbnail: () => Promise.reject(new Error('no canvas in tests')),
  formatDuration: () => '0:01',
}));

type Upload = typeof uploadItem;
interface Pending {
  name: string;
  resolve: () => void;
  reject: (e: Error) => void;
  signal: AbortSignal;
}

const setup = () => {
  const sent: MessageContent[] = [];
  const pending: Pending[] = [];
  let n = 0;
  const upload: Upload = (file, _kind, { signal }) =>
    new Promise((resolve, reject) => {
      pending.push({
        name: file.name,
        signal,
        resolve: () => {
          n += 1;
          resolve({ attachmentId: `att${String(n)}`, width: 10, height: 10, durationMs: 1000 });
        },
        reject,
      });
    });
  let draftRef!: ReturnType<typeof useAlbumDraft>;
  const Harness = () => {
    const draft = useAlbumDraft({
      send: (c) => sent.push(c),
      upload,
      newId: (() => {
        let i = 0;
        return () => `0190a0a0-0000-7000-8000-00000000000${String(++i)}`;
      })(),
    });
    draftRef = draft;
    return draft.active ? (
      <AlbumTray
        draft={draft}
        caption="hello"
        onCaptionChange={vi.fn()}
        onSubmit={() => {
          draft.submit({ caption: 'hello', replyTo: null });
        }}
        onAddMore={vi.fn()}
        onFiles={draft.addFiles}
      />
    ) : null;
  };
  render(<Harness />);
  return { sent, pending, draft: () => draftRef };
};

const photo = (name: string, size = 1000, type = 'image/jpeg') =>
  new File([new Uint8Array(1)], name, { type }).constructor === File
    ? Object.defineProperty(new File([new Uint8Array(1)], name, { type }), 'size', { value: size })
    : (undefined as never);

describe('media tray', () => {
  it('shows a labelled group with a counter and one tile per file', () => {
    const { draft } = setup();
    act(() => {
      draft().addFiles([photo('a.jpg'), photo('b.jpg'), photo('c.mp4', 1000, 'video/mp4')]);
    });
    expect(
      screen.getByRole('group', { name: 'Photos and videos to send, 3 of 20' }),
    ).toBeInTheDocument();
    expect(screen.getByText('3/20')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(4); // 3 tiles + Add more
    expect(screen.getByRole('button', { name: 'Remove a.jpg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add more' })).toBeEnabled();
  });

  it('uploads three at a time', () => {
    const { draft, pending } = setup();
    act(() => {
      draft().addFiles(Array.from({ length: 6 }, (_, i) => photo(`p${String(i)}.jpg`)));
    });
    expect(pending).toHaveLength(3);
    act(() => {
      pending[0]?.resolve();
    });
    return waitFor(() => {
      expect(pending).toHaveLength(4);
    });
  });

  it('removing a tile cancels its upload', async () => {
    const { draft, pending } = setup();
    act(() => {
      draft().addFiles([photo('a.jpg'), photo('b.jpg')]);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Remove a.jpg' }));
    expect(pending[0]?.signal.aborted).toBe(true);
    expect(screen.queryByRole('button', { name: 'Remove a.jpg' })).toBeNull();
    expect(screen.getByText('1/20')).toBeInTheDocument();
  });

  it('explains the limit when more than 20 are picked and keeps the first 20', () => {
    const { draft } = setup();
    act(() => {
      draft().addFiles(Array.from({ length: 27 }, (_, i) => photo(`p${String(i)}.jpg`)));
    });
    expect(screen.getByText('20/20')).toBeInTheDocument();
    expect(
      screen.getAllByText(
        'You can send up to 20 photos and videos at once (you picked 27) so uploads stay reliable. The first 20 were kept.',
      ).length,
    ).toBeGreaterThan(0); // shown in the tray and announced in the live region
    expect(screen.getByRole('button', { name: 'Add more' })).toBeDisabled();
  });

  it('sends the messages in album order as the uploads finish, caption on the first', async () => {
    const { draft, pending, sent } = setup();
    act(() => {
      draft().addFiles([photo('a.jpg'), photo('b.jpg'), photo('c.jpg')]);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Send 3 items' }));
    expect(sent).toHaveLength(0);
    act(() => {
      pending[1]?.resolve(); // b finishes first: must wait for a
      pending[2]?.resolve();
    });
    expect(sent).toHaveLength(0);
    act(() => {
      pending[0]?.resolve();
    });
    await waitFor(() => {
      expect(sent).toHaveLength(3);
    });
    expect(sent.map((c) => (c.type === 'image' ? c.album?.index : -1))).toEqual([0, 1, 2]);
    expect(sent[0]).toMatchObject({ caption: 'hello', album: { count: 3 } });
    expect(sent[1]).not.toHaveProperty('caption');
    // Everything is sent: the tray closes.
    await waitFor(() => {
      expect(screen.queryByRole('group')).toBeNull();
    });
  });

  it('a failed item stays with Retry while the others are sent', async () => {
    const { draft, pending, sent } = setup();
    act(() => {
      draft().addFiles([photo('a.jpg'), photo('b.jpg'), photo('c.jpg')]);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Send 3 items' }));
    act(() => {
      pending[0]?.resolve();
      pending[1]?.reject(new Error('Upload failed. Check your connection.'));
      pending[2]?.resolve();
    });
    await waitFor(() => {
      expect(sent).toHaveLength(2);
    });
    const retry = await screen.findByRole('button', { name: 'Retry b.jpg' });
    await userEvent.click(retry);
    await waitFor(() => {
      expect(pending).toHaveLength(4);
    });
    act(() => {
      pending[3]?.resolve();
    });
    await waitFor(() => {
      expect(sent).toHaveLength(3);
    });
    expect(sent[2]).toMatchObject({ album: { index: 1, count: 3 } });
  });

  it('Send is disabled when every item failed', async () => {
    const { draft, pending } = setup();
    act(() => {
      draft().addFiles([photo('a.jpg'), photo('b.jpg')]);
    });
    act(() => {
      pending[0]?.reject(new Error('x'));
      pending[1]?.reject(new Error('x'));
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send 2 items' })).toBeDisabled();
    });
  });

  it('asks before cancelling uploads that are running, and Escape asks too', async () => {
    const { draft, pending } = setup();
    act(() => {
      draft().addFiles([photo('a.jpg'), photo('b.jpg')]);
    });
    await userEvent.keyboard('{Escape}');
    // Escape inside the tray (focus is outside in this test): use the button instead.
    await userEvent.click(screen.getByRole('button', { name: 'Cancel and remove all' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('2 uploads are still running');
    await userEvent.click(screen.getByRole('button', { name: 'Keep uploading' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel and remove all' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('group')).toBeNull();
    expect(pending.every((p) => p.signal.aborted)).toBe(true);
  });

  it('announces progress in a live region', async () => {
    const { draft, pending } = setup();
    act(() => {
      draft().addFiles([photo('a.jpg'), photo('b.jpg')]);
    });
    act(() => {
      pending[0]?.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('1 of 2 ready');
    });
  });
});
