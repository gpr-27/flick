import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as aiApi from './aiApi';
import { DescribeImageDialog, INSERT_TEXT_EVENT } from './DescribeImageDialog';
import { resetAiEnabledCache } from './useAiEnabled';

vi.mock('./aiApi', async (importOriginal) => ({
  ...(await importOriginal<typeof aiApi>()),
  getAiEnabled: vi.fn(),
  analyzeAttachment: vi.fn(),
}));
const api = vi.mocked(aiApi);

const show = (onClose = vi.fn()) =>
  render(<DescribeImageDialog attachmentId="att-1" conversationId="c1" open onClose={onClose} />);

beforeEach(() => {
  resetAiEnabledCache();
  api.getAiEnabled.mockResolvedValue(true);
  api.analyzeAttachment.mockReset();
});

describe('Explain with Flick', () => {
  it('shows loading, then the default explanation', async () => {
    let finish!: (text: string) => void;
    api.analyzeAttachment.mockReturnValue(new Promise<string>((r) => (finish = r)));
    show();
    expect(
      await screen.findByRole('status', { name: 'Flick is reading this' }),
    ).toBeInTheDocument();
    finish('A cat on a sofa.');
    expect(await screen.findByText('A cat on a sofa.')).toBeInTheDocument();
    expect(api.analyzeAttachment).toHaveBeenCalledWith('att-1', undefined, expect.anything());
  });

  it('asks a follow-up question about the same file', async () => {
    api.analyzeAttachment.mockResolvedValueOnce('A receipt.').mockResolvedValueOnce('Total is 12.');
    const user = userEvent.setup();
    show();
    await screen.findByText('A receipt.');
    await user.type(screen.getByLabelText('Ask about this file'), 'What is the total?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('Total is 12.')).toBeInTheDocument();
    expect(api.analyzeAttachment).toHaveBeenLastCalledWith(
      'att-1',
      'What is the total?',
      expect.anything(),
    );
  });

  it('"Reply with this" sends the answer to the composer and closes', async () => {
    api.analyzeAttachment.mockResolvedValue('Summary text.');
    const heard = vi.fn();
    window.addEventListener(INSERT_TEXT_EVENT, (e) => {
      heard((e as CustomEvent).detail);
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    show(onClose);
    await screen.findByText('Summary text.');
    await user.click(screen.getByRole('button', { name: 'Reply with this' }));
    expect(heard).toHaveBeenCalledWith({ conversationId: 'c1', text: 'Summary text.' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the server message when it fails, and nothing when AI is off', async () => {
    api.analyzeAttachment.mockRejectedValue(new Error('boom'));
    const first = show();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    first.unmount();

    resetAiEnabledCache();
    api.getAiEnabled.mockResolvedValue(false);
    api.analyzeAttachment.mockClear();
    show();
    expect(await screen.findByText('AI is not set up on this server.')).toBeInTheDocument();
    await waitFor(() => {
      expect(api.analyzeAttachment).not.toHaveBeenCalled();
    });
  });

  it('draws markdown as bold text and list items, copies and replies with the raw text', async () => {
    const md =
      '**Description:** A close-up of a person.\n\n**Visible text:** None.\n\n**Notable details:**\n- **Background, left:** A sheer curtain.\n- **Glasses:** Round frames.';
    api.analyzeAttachment.mockResolvedValue(md);
    const heard = vi.fn();
    window.addEventListener(INSERT_TEXT_EVENT, (e) => {
      heard((e as CustomEvent).detail);
    });
    const user = userEvent.setup();
    show();
    const result = await screen.findByTestId('explain-result');
    expect(result.textContent).not.toContain('**');
    expect(within(result).getByText('Description:').tagName).toBe('STRONG');
    const items = within(result).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0] as HTMLElement).getByText('Background, left:').tagName).toBe('STRONG');
    await user.click(screen.getByRole('button', { name: 'Reply with this' }));
    expect(heard).toHaveBeenCalledWith({ conversationId: 'c1', text: md });
  });
});
