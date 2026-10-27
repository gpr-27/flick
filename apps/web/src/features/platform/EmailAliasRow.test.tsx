import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const call = vi.fn();
vi.mock('@/lib/services', () => ({ getApi: () => ({ call }) }));

import { EmailAliasRow } from './EmailAliasRow';

describe('EmailAliasRow', () => {
  it('shows the address with a Copy button', async () => {
    call.mockResolvedValue({ address: 'ann@mail.flick.app' });
    render(<EmailAliasRow />);
    expect(await screen.findByText('ann@mail.flick.app')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });
  it('renders nothing when email-to-chat is off', async () => {
    call.mockResolvedValue({ address: null });
    const { container } = render(<EmailAliasRow />);
    await waitFor(() => {
      expect(call).toHaveBeenCalled();
    });
    expect(container).toBeEmptyDOMElement();
  });
});
