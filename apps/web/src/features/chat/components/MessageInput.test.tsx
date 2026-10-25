// The message box: multi-line text as typed, paste, drop, shortcuts, camera and the small helpers.
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '@chat/contracts';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { useDraftStore } from '@/features/organise/drafts';
import { installFakeServices, makeConversation, ME } from '../../../../test/fakes';
import * as outbox from '../outbox/useOutboxStore';
import { useChatStore } from '../useChatStore';
import * as uploadModule from '../upload';
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

vi.mock('@/features/content/videoMeta', () => ({
  readVideoMeta: () => Promise.resolve({ width: 640, height: 360, durationMs: 4000 }),
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
    // The preview draws the markdown the way the chat will: a heading, not the "# " characters.
    const preview = screen.getByRole('region', { name: 'Message preview' });
    expect(within(preview).getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    expect(preview).not.toHaveTextContent('#');
  });
});

describe('the preview before sending', () => {
  const drop = (field: HTMLElement, file: File) =>
    fireEvent.drop(field.closest('form')!, { dataTransfer: { files: [file], types: ['Files'] } });

  it('a video can be played before it is sent', () => {
    vi.spyOn(uploadModule, 'uploadAttachment').mockReturnValue(new Promise(() => undefined));
    const { field } = setup();
    drop(field, new File(['v'], 'clip.mp4', { type: 'video/mp4' }));
    const video = screen.getByLabelText('Video preview');
    expect(video.tagName).toBe('VIDEO');
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('src', 'blob:fake');
    expect(screen.queryByText('clip.mp4')).not.toBeInTheDocument();
  });

  it('an audio file gets a player, a photo a thumbnail, a document just its name', () => {
    vi.spyOn(uploadModule, 'uploadAttachment').mockReturnValue(new Promise(() => undefined));
    const { field } = setup();
    drop(field, new File(['a'], 'song.mp3', { type: 'audio/mpeg' }));
    expect(screen.getByLabelText('Audio preview').tagName).toBe('AUDIO');
    drop(field, new File(['x'], 'shot.png', { type: 'image/png' }));
    expect(screen.getByAltText('Selected image preview')).toBeInTheDocument();
    expect(screen.queryByLabelText('Audio preview')).not.toBeInTheDocument();
    drop(field, new File(['p'], 'report.pdf', { type: 'application/pdf' }));
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.queryByLabelText('Video preview')).not.toBeInTheDocument();
  });
});

describe('files upload as soon as they are attached', () => {
  const video = () => new File(['v'], 'clip.mp4', { type: 'video/mp4' });
  const attachVideo = (field: HTMLElement) =>
    fireEvent.drop(field.closest('form')!, {
      dataTransfer: { files: [video()], types: ['Files'] },
    });

  it('uploads before Send is pressed, then Send sends at once without uploading again', async () => {
    const user = userEvent.setup();
    const upload = vi.spyOn(uploadModule, 'uploadAttachment').mockResolvedValue('att-1');
    const { send, field } = setup();
    attachVideo(field);
    expect(await screen.findByText('Ready to send')).toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();

    await user.type(field, 'look at this');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(ME, conv.id, {
      type: 'video',
      attachment_id: 'att-1',
      width: 640,
      height: 360,
      duration_ms: 4000,
      caption: 'look at this',
    });
    expect(upload).toHaveBeenCalledTimes(1); // not uploaded a second time
    expect(screen.queryByText('clip.mp4')).not.toBeInTheDocument();
  });

  it('Send while the upload is still running sends by itself when it finishes', async () => {
    const user = userEvent.setup();
    let finish: (id: string) => void = () => undefined;
    vi.spyOn(uploadModule, 'uploadAttachment').mockReturnValue(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    );
    const { send, field } = setup();
    attachVideo(field);
    await user.click(await screen.findByRole('button', { name: 'Send message' }));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByText('Sending when ready…')).toBeInTheDocument();

    finish('att-2');
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    expect(send.mock.calls[0]?.[2]).toMatchObject({ type: 'video', attachment_id: 'att-2' });
    expect(screen.queryByText('clip.mp4')).not.toBeInTheDocument();
  });

  it('a failed upload shows the error, and Send tries again and sends when it works', async () => {
    const user = userEvent.setup();
    const upload = vi
      .spyOn(uploadModule, 'uploadAttachment')
      .mockRejectedValueOnce(new Error('Upload failed. Check your connection.'))
      .mockResolvedValueOnce('att-3');
    const { send, field } = setup();
    attachVideo(field);
    expect(await screen.findByRole('alert')).toHaveTextContent(/upload/i);
    expect(send).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[2]).toMatchObject({ attachment_id: 'att-3' });
  });

  it('removing the file while it uploads drops it: nothing is sent', async () => {
    const user = userEvent.setup();
    let finish: (id: string) => void = () => undefined;
    vi.spyOn(uploadModule, 'uploadAttachment').mockReturnValue(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    );
    const { send, field } = setup();
    attachVideo(field);
    await user.click(await screen.findByRole('button', { name: 'Send message' }));
    await user.click(screen.getByRole('button', { name: 'Remove attachment' }));
    finish('att-4');
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();
    expect(screen.queryByText('Sending when ready…')).not.toBeInTheDocument();
  });
});
