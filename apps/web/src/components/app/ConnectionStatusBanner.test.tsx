import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type FakeTransport, installFakeServices } from '../../../test/fakes';
import { ConnectionStatusBanner } from './ConnectionStatusBanner';
import { RECONNECT_BANNER_DELAY_MS } from './connectionBanner';

let transport: FakeTransport;
beforeEach(() => {
  vi.useFakeTimers();
  ({ transport } = installFakeServices());
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ConnectionStatusBanner', () => {
  it('shows offline immediately', () => {
    render(<ConnectionStatusBanner />);
    act(() => {
      transport.setState('offline');
    });
    expect(screen.getByRole('status')).toHaveTextContent("You're offline");
  });

  it('shows reconnecting only after a short delay, and clears on recovery', () => {
    render(<ConnectionStatusBanner />);
    act(() => {
      transport.setState('reconnecting');
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    act(() => {
      vi.advanceTimersByTime(RECONNECT_BANNER_DELAY_MS);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting');

    act(() => {
      transport.setState('connected');
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
