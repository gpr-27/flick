import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A development build (the test build skips the check), pointing at a made-up server.
vi.mock('@/config/env', () => ({
  config: { env: 'development', socketUrl: 'http://api.test' },
}));

import { ServerWakeNotice } from './ServerWakeNotice';
import { useServerWake } from './useServerWake';

beforeEach(() => {
  vi.useFakeTimers();
  useServerWake.setState({ waking: false, since: null });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ServerWakeNotice', () => {
  it('shows nothing while the server answers quickly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))),
    );
    render(<ServerWakeNotice />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.queryByTestId('server-wake')).not.toBeInTheDocument();
  });

  it('tells the person the server is waking up, then goes away when it is up', async () => {
    let answer: (r: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      ),
    );
    render(<ServerWakeNotice />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_500);
    });
    const notice = screen.getByTestId('server-wake');
    expect(notice).toHaveTextContent('The server is waking up');
    expect(notice).toHaveTextContent('about 30 seconds');
    expect(notice).toHaveTextContent(/Waiting \d+ s/);

    await act(async () => {
      answer(new Response('{}', { status: 200 }));
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.queryByTestId('server-wake')).not.toBeInTheDocument();
  });

  it('counts the seconds while it waits', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    render(<ServerWakeNotice />);
    // The notice appears after 3 s; the counter then ticks once a second.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_500);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_500);
    });
    expect(screen.getByTestId('server-wake')).toHaveTextContent(/Waiting [5-9] s/);
  });

  it('after 45 seconds it stops promising "30 seconds" and says it is still starting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    render(<ServerWakeNotice />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(screen.getByTestId('server-wake')).toHaveTextContent('about 30 seconds');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    const notice = screen.getByTestId('server-wake');
    expect(notice).toHaveTextContent('Still starting up');
    expect(notice).not.toHaveTextContent('about 30 seconds');
  });

  it('asks the server on the health route, not a data route', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    render(<ServerWakeNotice />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/health/live', expect.anything());
  });
});
