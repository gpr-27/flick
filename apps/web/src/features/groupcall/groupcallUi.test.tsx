import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { ApiError } from '@/lib/api';
import { CONV, type FakeApi, installFakeServices, makeMessage } from '../../../test/fakes';
import { findActiveGroupCall } from './activeCall';
import { CallLinkPage } from './CallLinkPage';
import { CallLinkSection } from './components/CallLinkSection';
import { GroupCallBanner } from './components/GroupCallBanner';
import { GroupCallOverlay } from './components/GroupCallOverlay';
import { useGroupCallStore } from './useGroupCallStore';

const CODE = 'abcdefghij1234567890';
const FUTURE = new Date(Date.now() + 3_600_000).toISOString();
const link = {
  code: CODE,
  conversation_id: CONV,
  media: 'video',
  created_by: null,
  expires_at: FUTURE,
};

let api: FakeApi;
beforeEach(() => {
  vi.clearAllMocks();
  ({ api } = installFakeServices());
  useGroupCallStore.getState().leave();
});

const started = (ageMs = 0) =>
  makeMessage({
    created_at: new Date(Date.now() - ageMs).toISOString(),
    content: {
      type: 'call_event',
      call_id: CONV,
      media: 'video',
      outcome: 'started',
      group: true,
      started_at: new Date().toISOString(),
      duration_s: 0,
    },
  });

describe('active group call', () => {
  it('is the latest "started" message, for one hour', () => {
    expect(findActiveGroupCall([makeMessage(), started()])).not.toBeNull();
    expect(findActiveGroupCall([started(2 * 3_600_000)])).toBeNull();
    expect(findActiveGroupCall([makeMessage()])).toBeNull();
  });

  it('shows a Join call button that joins the conversation call', async () => {
    api.call.mockRejectedValue(
      new ApiError({ status: 501, code: 'FEATURE_DISABLED', message: 'x' }),
    );
    render(<GroupCallBanner conversationId={CONV} messages={[started()]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Join call' }));
    expect(api.call).toHaveBeenCalledWith(expect.anything(), { body: { conversation_id: CONV } });
    expect(useGroupCallStore.getState().error).toMatch(/not set up/);
  });

  it('shows nothing when there is no recent call', () => {
    render(<GroupCallBanner conversationId={CONV} messages={[makeMessage()]} />);
    expect(screen.queryByRole('button', { name: 'Join call' })).toBeNull();
  });
});

describe('GroupCallOverlay', () => {
  it('shows tiles with the speaker marked, and lets you leave', async () => {
    const tile = { sharing: false, videoTrack: null };
    useGroupCallStore.setState({
      status: 'connected',
      micOn: true,
      participants: [
        { ...tile, identity: 'a', name: 'Ann', isLocal: true, speaking: false, micOn: true },
        { ...tile, identity: 'b', name: 'Bo', isLocal: false, speaking: true, micOn: false },
      ],
    });
    render(<GroupCallOverlay />);
    expect(screen.getByLabelText('Bo, speaking')).toHaveAttribute('data-speaking', 'true');
    expect(screen.getByLabelText('Ann (you)')).toHaveAttribute('data-speaking', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Leave call' }));
    expect(useGroupCallStore.getState().status).toBe('idle');
  });

  it('shows reconnecting and error messages', () => {
    useGroupCallStore.setState({ status: 'reconnecting' });
    const { rerender } = render(<GroupCallOverlay />);
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting');
    useGroupCallStore.setState({ status: 'error', error: 'This call is full.' });
    rerender(<GroupCallOverlay />);
    expect(screen.getByRole('alert')).toHaveTextContent('This call is full.');
  });
});

describe('call link route', () => {
  const open = (path = `/call/${CODE}`) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/call/:token" element={<CallLinkPage />} />
        </Routes>
      </MemoryRouter>,
    );

  it('resolves the link and joins with the code', async () => {
    api.call.mockImplementation((ep) => {
      const path = (ep as { path: string }).path;
      return path === '/calls/links/:code'
        ? Promise.resolve(link)
        : Promise.reject(new ApiError({ status: 409, code: 'GROUP_FULL', message: 'full' }));
    });
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Join call' }));
    expect(api.call).toHaveBeenLastCalledWith(expect.anything(), { body: { call_link: CODE } });
    await waitFor(() => {
      expect(useGroupCallStore.getState().error).toBe('This call is full.');
    });
  });

  it.each([
    [404, 'Link not found'],
    [410, 'Link expired'],
  ])('shows the state for HTTP %i', async (status, title) => {
    api.call.mockRejectedValue(new ApiError({ status, code: 'X', message: 'x' }));
    open();
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
  });

  it('treats a link past its expiry time as expired', async () => {
    api.call.mockResolvedValue({ ...link, expires_at: new Date(Date.now() - 1000).toISOString() });
    open();
    expect(await screen.findByRole('heading', { name: 'Link expired' })).toBeInTheDocument();
  });

  it('treats a malformed code as not found without asking the server', async () => {
    open('/call/short');
    expect(await screen.findByRole('heading', { name: 'Link not found' })).toBeInTheDocument();
  });
});

describe('CallLinkSection', () => {
  it('creates a link for the group, copies it and revokes it', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    api.call.mockResolvedValueOnce(link);
    render(<CallLinkSection conversationId={CONV} />);
    await userEvent.click(screen.getByRole('button', { name: /create link/i }));
    expect(api.call).toHaveBeenCalledWith(expect.anything(), {
      body: { conversation_id: CONV, media: 'video' },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Copy call link' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/call/${CODE}`);

    api.call.mockResolvedValueOnce(undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'Call link' })).toBeNull();
    });
  });
});
