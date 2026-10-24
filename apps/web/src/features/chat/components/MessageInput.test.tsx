// The message box: multi-line text as typed, paste, drop, shortcuts, camera and the small helpers.
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '@chat/contracts';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { useDraftStore } from '@/features/organise/drafts';
import { installFakeServices, makeConversation, ME } from '../../../../test/fakes';
import * as outbox from '../outbox/useOutboxStore';
import { useChatStore } from '../useChatStore';
import { MessageInput } from './MessageInput';

vi.mock('@/features/content/camera/CameraCapture', () => ({
  CameraCapture: ({
    onCapture,
    onClose,
  }: {
    onCapture: (f: File) => void;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label="Camera">
      <button
        type="button"
        onClick={() => {
          onCapture(new File(['x'], 'photo.jpg', { type: 'image/jpeg' }));
          onClose();
        }}
      >
        Fake shutter
      </button>
    </div>
  ),
}));

const conv = makeConversation();

beforeEach(() => {
  localStorage.clear();
  useChatStore.getState().reset();
  useDraftStore.setState({ drafts: {} });
  useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
  installFakeServices();
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
});

const setup = () => {
  const send = vi.spyOn(outbox, 'sendMessage').mockReturnValue('id');
  render(<MessageInput conversation={conv} messages={[]} />);
  return { send, field: screen.getByLabelText<HTMLTextAreaElement>(/Message Bob/) };
};

const clipboard = (data: Record<string, string>, files: File[] = []) => ({
  clipboardData: { getData: (t: string) => data[t] ?? '', files },
});

describe('multi-line text', () => {
  it('Enter sends, Shift+Enter adds a line, and the text is sent as typed', async () => {
    const user = userEvent.setup();
    const { send, field } = setup();
    await user.type(
      field,
      'first{Shift>}{Enter}{/Shift}    indented{Shift>}{Enter}{/Shift}{Enter}',
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(ME, conv.id, { type: 'text', text: 'first\n    indented' });
    expect(field).toHaveValue('');
  });

  it('does not send an empty message', async () => {
    const user = userEvent.setup();
    const { send, field } = setup();
    await user.type(field, '{Shift>}{Enter}{/Shift}{Enter}');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('small helpers', () => {
  it('"/flick" becomes "@flick "', async () => {
    const user = userEvent.setup();
    const { field } = setup();
    await user.type(field, '/flick');
    expect(field).toHaveValue('@flick ');
  });

  it('suggests emoji for ":smi" and inserts the chosen one', async () => {
    const user = userEvent.setup();
    const { field } = setup();
    await user.type(field, 'hi :smi');
    expect(screen.getByRole('listbox', { name: 'Emoji suggestions' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(field).toHaveValue('hi 😄');
  });

  it('a typed ":fire:" turns into the emoji', async () => {
    const user = userEvent.setup();
    const { field } = setup();
    await user.type(field, ':fire:');
    expect(field).toHaveValue('🔥');
  });

  it('shows the counter near the limit and blocks sending past it', () => {
    const { send, field } = setup();
    fireEvent.change(field, { target: { value: 'a'.repeat(LIMITS.MAX_TEXT_LENGTH - 10) } });
    expect(screen.getByRole('status')).toHaveTextContent('10 characters left');
    fireEvent.change(field, { target: { value: 'a'.repeat(LIMITS.MAX_TEXT_LENGTH + 2) } });
    expect(screen.getByRole('status')).toHaveTextContent('2 characters too many');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps the draft per chat', async () => {
    const user = userEvent.setup();
    const { field } = setup();
    await user.type(field, 'later');
    expect(useDraftStore.getState().drafts[conv.id]).toBe('later');
  });
});

describe('files', () => {
  it('pasting an image attaches it', () => {
    const { field } = setup();
    const png = new File(['x'], 'shot.png', { type: 'image/png' });
    fireEvent.paste(field, clipboard({}, [png]));
    expect(screen.getByAltText('Selected image preview')).toBeInTheDocument();
  });

  it('dropping a file onto the composer attaches it', () => {
    setup();
    const form = screen.getByRole('form', { name: 'Send a message' });
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' });
    fireEvent.drop(form, { dataTransfer: { files: [file], types: ['Files'] } });
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
  });

  it('a photo from the camera goes through the same attachment path', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Open camera' }));
    await user.click(screen.getByRole('button', { name: 'Fake shutter' }));
    expect(screen.getByAltText('Selected image preview')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Camera' })).not.toBeInTheDocument();
  });

  it('the phone menu has a Camera action', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Camera' }));
    expect(screen.getByRole('dialog', { name: 'Camera' })).toBeInTheDocument();
  });
});

describe('pasting a table', () => {
  const tsv = 'Name\tQty\nPen\t3';

  it('becomes a markdown table, and Undo brings back the plain text', async () => {
    const user = userEvent.setup();
    const { field } = setup();
    fireEvent.paste(field, clipboard({ 'text/plain': tsv }));
    expect(field.value).toBe('| Name | Qty |\n| --- | --- |\n| Pen | 3 |\n');
    expect(screen.getByText(/Pasted as table/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(field.value).toBe(tsv);
    expect(screen.queryByText(/Pasted as table/)).not.toBeInTheDocument();
  });

  it('ordinary text pastes as usual', () => {
    const { field } = setup();
    fireEvent.paste(field, clipboard({ 'text/plain': 'just words' }));
    expect(screen.queryByText(/Pasted as table/)).not.toBeInTheDocument();
  });
});

describe('formatting toolbar', () => {
  it('wraps the selection with the Bold button and Ctrl+B', async () => {
    const user = userEvent.setup();
    const { field } = setup();
    await user.click(screen.getByRole('button', { name: 'Formatting', pressed: false }));
    await user.type(field, 'hello');
    field.setSelectionRange(0, 5);
    await user.click(screen.getByRole('button', { name: 'Bold' }));
    expect(field).toHaveValue('**hello**');
    field.setSelectionRange(2, 7);
    await user.keyboard('{Control>}i{/Control}');
    expect(field).toHaveValue('**_hello_**');
  });

  it('Ctrl+E makes inline code and the Table button inserts a template', async () => {
    const user = userEvent.setup();
    const { field } = setup();
    await user.click(screen.getByRole('button', { name: 'Formatting' }));
    await user.type(field, 'x');
    field.setSelectionRange(0, 1);
    await user.keyboard('{Control>}e{/Control}');
    expect(field).toHaveValue('`x`');
    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(field.value).toContain('| Column 1 | Column 2 | Column 3 |');
  });

  it('Preview shows the text that will be sent', async () => {
    const user = userEvent.setup();
    const { field } = setup();
    await user.click(screen.getByRole('button', { name: 'Formatting' }));
    await user.type(field, '# Title');
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('region', { name: 'Message preview' })).toHaveTextContent('# Title');
  });
});
