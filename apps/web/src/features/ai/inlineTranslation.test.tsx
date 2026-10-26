import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineTranslation } from './InlineTranslation';
import { clearTranslationCache } from './translationCache';

const translate = vi.hoisted(() => vi.fn());
vi.mock('./aiApi', () => ({ translateText: translate }));

describe('InlineTranslation', () => {
  beforeEach(() => {
    clearTranslationCache();
    translate.mockReset();
    translate.mockResolvedValue({ text: 'Hello', model: 'm' });
  });

  it('shows the translation, caches it per message, and hides on Show original', async () => {
    const onHide = vi.fn();
    const { unmount } = render(<InlineTranslation messageId="m1" text="Hola" onHide={onHide} />);
    expect(await screen.findByText('Hello')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /show original/i }));
    expect(onHide).toHaveBeenCalled();
    unmount();
    render(<InlineTranslation messageId="m1" text="Hola" onHide={onHide} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(translate).toHaveBeenCalledTimes(1);
  });
});
