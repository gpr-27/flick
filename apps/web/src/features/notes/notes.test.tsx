import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const call = vi.fn();
vi.mock('@/lib/services', () => ({ getApi: () => ({ call }) }));

import { useNoteStore } from './noteStore';
import { EditHistoryDialog, NoteChip, NoteDialog } from './MessageNotes';

beforeEach(() => {
  call.mockReset();
  useNoteStore.setState({ notes: {}, loaded: {} });
});

describe('message notes', () => {
  it('shows a loaded note under the message', async () => {
    call.mockResolvedValue({ notes: [{ message_id: 'm1', body: 'call mum' }] });
    render(<NoteChip conversationId="c1" messageId="m1" />);
    expect(await screen.findByTestId('note-chip')).toHaveTextContent('call mum');
  });

  it('saves a note from the dialog', async () => {
    call.mockResolvedValue({ message_id: 'm1', body: 'hello' });
    const onClose = vi.fn();
    render(<NoteDialog conversationId="c1" messageId="m1" onClose={onClose} />);
    await userEvent.type(screen.getByRole('textbox'), 'hello');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(useNoteStore.getState().notes.m1).toBe('hello');
  });

  it('lists earlier versions in the edit history', async () => {
    call.mockResolvedValue({
      edits: [{ body_text: 'first draft', edited_at: '2026-01-01T10:00:00Z' }],
    });
    render(<EditHistoryDialog conversationId="c1" messageId="m1" onClose={vi.fn()} />);
    expect(await screen.findByText('first draft')).toBeInTheDocument();
  });
});
