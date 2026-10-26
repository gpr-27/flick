import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ENDPOINTS } from '@chat/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderContent } from '@/features/chat/content/registry';
import { CONV, installFakeServices, nextId, type FakeApi } from '../../../test/fakes';

let api: FakeApi;
let served = 0;

beforeEach(() => {
  ({ api } = installFakeServices());
  served = 0;
  // Every call hands out a different signed link, like the real endpoint.
  api.call.mockImplementation((endpoint) => {
    // Other calls (e.g. the transcript lookup) must not use up a link.
    if (endpoint !== ENDPOINTS.media.download) return Promise.resolve(undefined);
    served += 1;
    return Promise.resolve({
      url: `https://files.test/signed-${served}`,
      expires_at: '2999-01-01T00:00:00.000Z',
    });
  });
});

describe('expired signed media links', () => {
  it('video: an error shows Reload, which fetches a fresh link', async () => {
    const { container } = render(
      <>
        {renderContent(
          {
            type: 'video',
            attachment_id: nextId(),
            width: 640,
            height: 360,
            duration_ms: 1000,
          },
          { onOpenImage: vi.fn(), message: { id: nextId(), conversationId: CONV, isMine: false } },
        )}
      </>,
    );
    await waitFor(() => {
      expect(container.querySelector('video')).toHaveAttribute(
        'src',
        'https://files.test/signed-1',
      );
    });
    fireEvent.error(container.querySelector('video') as HTMLVideoElement);
    await userEvent.click(await screen.findByRole('button', { name: 'Reload video' }));
    await waitFor(() => {
      expect(container.querySelector('video')).toHaveAttribute(
        'src',
        'https://files.test/signed-2',
      );
    });
  });

  it('image: an error shows Reload, which fetches a fresh link', async () => {
    const { container } = render(
      <>
        {renderContent(
          { type: 'image', attachment_id: nextId(), width: 10, height: 10 },
          { onOpenImage: vi.fn(), message: { id: nextId(), conversationId: CONV, isMine: false } },
        )}
      </>,
    );
    await waitFor(() => {
      expect(container.querySelector('img')).not.toBeNull();
    });
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    await userEvent.click(await screen.findByRole('button', { name: 'Reload image' }));
    await waitFor(() => {
      expect(container.querySelector('img')).toHaveAttribute('src', 'https://files.test/signed-2');
    });
  });

  it('voice note: an audio error shows Reload', async () => {
    const { container } = render(
      <>
        {renderContent(
          {
            type: 'voice',
            attachment_id: nextId(),
            duration_ms: 3000,
            waveform: [1, 2, 3],
          } as never,
          { onOpenImage: vi.fn(), message: { id: nextId(), conversationId: CONV, isMine: false } },
        )}
      </>,
    );
    await waitFor(() => {
      expect(container.querySelector('audio')).not.toBeNull();
    });
    fireEvent.error(container.querySelector('audio') as HTMLAudioElement);
    await userEvent.click(await screen.findByRole('button', { name: 'Reload voice message' }));
    await waitFor(() => {
      expect(container.querySelector('audio')).toHaveAttribute(
        'src',
        'https://files.test/signed-2',
      );
    });
  });
});
