// The composer: sending, drafts, typing signal, emoji, reply, edit, attachments and uploads.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ENDPOINTS, TYPING } from '@chat/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const upload = vi.hoisted(() => ({ uploadAttachment: vi.fn() }));
vi.mock('../upload', () => upload);
const compress = vi.hoisted(() => ({ prepareImage: vi.fn() }));
vi.mock('@/lib/imageCompress', () => compress);
const video = vi.hoisted(() => ({ readVideoMeta: vi.fn() }));
vi.mock('@/features/content/videoMeta', () => video);

import { useSessionStore } from '@/features/auth/useSessionStore';
import { useDraftStore } from '../../organise/drafts';
import {
  BOB,
  CONV,
  ME,
  installFakeServices,
  makeConversation,
  makeMessage,
  nextId,
  type FakeApi,
  type FakeTransport,
} from '../../../../test/fakes';
import { like } from '../../../../test/matchers';
import { expectNoA11yViolations } from '../../../../test/a11y';
import { configureOutboxStorage, useOutboxStore } from '../outbox/useOutboxStore';
import { createMemoryKv } from '@/lib/idb';
import type { OutboxItem } from '../outbox/outboxMachine';
import { useChatStore } from '../useChatStore';
import { MessageInput } from './MessageInput';

let api: FakeApi;
let transport: FakeTransport;
const conversation = makeConversation();
const queued = () => useOutboxStore.getState().items;

const mount = (messages = [] as ReturnType<typeof makeMessage>[]) =>
  render(<MessageInput conversation={conversation} messages={messages} />);
const box = () => screen.getByRole('textbox', { name: /^(Message |Edit your message)/ });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  ({ api, transport } = installFakeServices());
  configureOutboxStorage(createMemoryKv<OutboxItem>());
  useOutboxStore.setState({ items: [], ready: false });
  useChatStore.getState().reset();
  useChatStore.setState({ users: { [BOB]: conversation.peer! } });
  useDraftStore.setState({ drafts: {} });
  useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
  upload.uploadAttachment.mockResolvedValue(nextId());
  compress.prepareImage.mockResolvedValue({
    blob: new Blob(['x'], { type: 'image/jpeg' }),
    width: 640,
    height: 480,
  });
  video.readVideoMeta.mockResolvedValue({ width: 1280, height: 720, durationMs: 4000 });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('sending text', () => {
  it('Enter queues the text without trailing space, clears the box and keeps focus', async () => {
    const user = userEvent.setup();
    mount();
    // Indentation on the first line is kept (it can be markdown); blank space at the end is not.
    await user.type(box(), '  hello there  {Enter}');
    expect(queued()).toHaveLength(1);
    expect(queued()[0]).toMatchObject({
      conversation_id: CONV,
      user_id: ME,
      content: { type: 'text', text: '  hello there' },
    });
    expect(box()).toHaveValue('');
    expect(box()).toHaveFocus();
  });

  it('a multi-line message keeps its inner line breaks and drops leading blank lines', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(box(), '{Shift>}{Enter}{/Shift}one{Shift>}{Enter}{Enter}{/Shift}two  {Enter}');
    expect(queued()).toHaveLength(1);
    expect(queued()[0]).toMatchObject({ content: { type: 'text', text: 'one\n\ntwo' } });
  });

  it('the Send button is disabled for empty or blank text', async () => {
    const user = userEvent.setup();
    mount();
    const send = screen.getByRole('button', { name: 'Send message' });
    expect(send).toBeDisabled();
    await user.type(box(), '   ');
    expect(send).toBeDisabled();
    await user.type(box(), 'x');
    expect(send).toBeEnabled();
    await user.keyboard('{Backspace}{Backspace}{Backspace}{Backspace}');
    expect(send).toBeDisabled();
  });

  it('Enter on blank text sends nothing', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(box(), '   {Enter}');
    expect(queued()).toEqual([]);
  });

  it('a very long message is sent whole', async () => {
    const user = userEvent.setup();
    mount();
    const long = 'word '.repeat(2000).trim();
    await user.click(box());
    await user.paste(long);
    await user.keyboard('{Enter}');
    expect(queued()[0]?.content).toMatchObject({ text: long });
  });

  it('does nothing without a signed-in user', async () => {
    const user = userEvent.setup();
    useSessionStore.setState({ user: null, status: 'anonymous' });
    mount();
    await user.type(box(), 'hi{Enter}');
    expect(queued()).toEqual([]);
  });

  it('a message is queued even when offline (the outbox sends it later)', async () => {
    const user = userEvent.setup();
    transport.open = false;
    mount();
    await user.type(box(), 'offline hello{Enter}');
    expect(queued()[0]).toMatchObject({ status: 'pending' });
    expect(transport.sentOf('send_message')).toEqual([]);
  });
});

describe('drafts', () => {
  it('restores the saved draft on mount and saves while typing', async () => {
    const user = userEvent.setup();
    useDraftStore.getState().setDraft(CONV, 'half a thought');
    mount();
    expect(box()).toHaveValue('half a thought');
    await user.type(box(), '!');
    expect(useDraftStore.getState().drafts[CONV]).toBe('half a thought!');
  });

  it('sending clears the draft', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(box(), 'bye{Enter}');
    expect(useDraftStore.getState().drafts[CONV]).toBeUndefined();
  });

  it('the draft survives leaving and coming back to the chat', async () => {
    const user = userEvent.setup();
    const first = mount();
    await user.type(box(), 'keep me');
    first.unmount();
    mount();
    expect(box()).toHaveValue('keep me');
  });

  it('text being edited never overwrites the draft', async () => {
    const user = userEvent.setup();
    useDraftStore.getState().setDraft(CONV, 'my draft');
    const mine = makeMessage({
      seq: 1,
      sender_user_id: ME,
      content: { type: 'text', text: 'sent text' },
    });
    mount([mine]);
    act(() => {
      useChatStore.getState().setEditing(mine);
    });
    expect(box()).toHaveValue('sent text');
    await user.type(box(), ' more');
    expect(useDraftStore.getState().drafts[CONV]).toBe('my draft');
  });
});

describe('typing signal', () => {
  it('sends typing_start when typing and typing_stop after 3 s of quiet', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    mount();
    fireEvent.change(box(), { target: { value: 'h' } });
    expect(transport.sentOf('typing_start')).toEqual([{ conversation_id: CONV }]);
    vi.advanceTimersByTime(2999);
    expect(transport.sentOf('typing_stop')).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(transport.sentOf('typing_stop')).toEqual([{ conversation_id: CONV }]);
  });

  it('keeps sending only once per throttle window while typing', () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    mount();
    for (const v of ['a', 'ab', 'abc']) fireEvent.change(box(), { target: { value: v } });
    expect(transport.sentOf('typing_start')).toHaveLength(1);
    vi.advanceTimersByTime(TYPING.THROTTLE_MS);
    fireEvent.change(box(), { target: { value: 'abcd' } });
    expect(transport.sentOf('typing_start')).toHaveLength(2);
  });

  it('erasing the text does not announce typing; sending stops it at once', () => {
    vi.useFakeTimers();
    vi.setSystemTime(3_000_000);
    mount();
    fireEvent.change(box(), { target: { value: '' } });
    expect(transport.sentOf('typing_start')).toEqual([]);
    fireEvent.change(box(), { target: { value: 'x' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Send a message' }));
    expect(transport.sentOf('typing_stop')).toHaveLength(1);
  });

  it('leaving the chat stops the typing signal', () => {
    vi.useFakeTimers();
    vi.setSystemTime(4_000_000);
    const view = mount();
    fireEvent.change(box(), { target: { value: 'x' } });
    view.unmount();
    expect(transport.sentOf('typing_stop')).toHaveLength(1);
  });
});

describe('emoji picker', () => {
  it('opens from the button, inserts at the end and stays open for more', async () => {
    const user = userEvent.setup();
    mount();
    await user.type(box(), 'hi ');
    await user.click(screen.getByRole('button', { name: 'Insert emoji' }));
    const picker = screen.getByRole('dialog', { name: 'Emoji picker' });
    await user.click(within(picker).getByRole('button', { name: 'Insert 😂' }));
    await user.click(within(picker).getByRole('button', { name: 'Insert 🔥' }));
    expect(box()).toHaveValue('hi 😂🔥');
    expect(screen.getByRole('dialog', { name: 'Emoji picker' })).toBeInTheDocument();
  });

  it('the trigger reports expanded state', async () => {
    const user = userEvent.setup();
    mount();
    const trigger = screen.getByRole('button', { name: 'Insert emoji' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('arrow keys move through the grid (8 per row) and Enter inserts', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Insert emoji' }));
    const picker = screen.getByRole('dialog', { name: 'Emoji picker' });
    const buttons = within(picker).getAllByRole('button');
    expect(buttons[0]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(buttons[1]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(buttons[9]).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowUp}');
    expect(buttons[0]).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowLeft}');
    expect(buttons[0]).toHaveFocus(); // clamped at the start
    await user.keyboard('{Enter}');
    expect(box()).toHaveValue(buttons[0]!.textContent);
  });

  it('Escape closes it and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    mount();
    const trigger = screen.getByRole('button', { name: 'Insert emoji' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('clicking outside closes it; sending closes it', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'Insert emoji' }));
    fireEvent.click(document.querySelector('.fixed.inset-0.z-10')!);
    expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Insert emoji' }));
    await user.type(box(), 'x{Enter}');
    expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).not.toBeInTheDocument();
  });
});

describe('reply', () => {
  const original = makeMessage({
    seq: 4,
    sender_user_id: BOB,
    content: { type: 'text', text: 'lunch at 1?' },
  });

  it('shows who and what is being replied to, and the reply carries reply_to', async () => {
    const user = userEvent.setup();
    mount();
    act(() => {
      useChatStore.getState().setReplyingTo(original);
    });
    expect(screen.getByText('Replying to Bob')).toBeInTheDocument();
    expect(screen.getByText('lunch at 1?')).toBeInTheDocument();
    expect(box()).toHaveFocus();
    await user.type(box(), 'sure{Enter}');
    expect(queued()[0]?.content).toMatchObject({
      type: 'text',
      text: 'sure',
      reply_to: original.message_id,
    });
    expect(useChatStore.getState().replyingTo).toBeNull();
    expect(screen.queryByText('Replying to Bob')).not.toBeInTheDocument();
  });

  it('replying to my own message says "yourself"', () => {
    mount();
    act(() => {
      useChatStore.getState().setReplyingTo({ ...original, sender_user_id: ME });
    });
    expect(screen.getByText('Replying to yourself')).toBeInTheDocument();
  });

  it('Escape and the cancel button drop the reply but keep the typed text', async () => {
    const user = userEvent.setup();
    mount();
    act(() => {
      useChatStore.getState().setReplyingTo(original);
    });
    await user.type(box(), 'draft');
    await user.keyboard('{Escape}');
    expect(useChatStore.getState().replyingTo).toBeNull();
    expect(box()).toHaveValue('draft');
    act(() => {
      useChatStore.getState().setReplyingTo(original);
    });
    await user.click(screen.getByRole('button', { name: 'Cancel reply' }));
    expect(useChatStore.getState().replyingTo).toBeNull();
  });

  it('the input is described by the reply context', () => {
    mount();
    act(() => {
      useChatStore.getState().setReplyingTo(original);
    });
    expect(box()).toHaveAccessibleDescription('Replying to Bob');
  });
});

describe('edit', () => {
  const mine = makeMessage({
    seq: 3,
    sender_user_id: ME,
    content: { type: 'text', text: 'typo here' },
  });

  it("ArrowUp in an empty box edits my last text message, not someone else's", async () => {
    const user = userEvent.setup();
    const theirs = makeMessage({ seq: 5, sender_user_id: BOB });
    mount([mine, theirs]);
    await user.click(box());
    await user.keyboard('{ArrowUp}');
    expect(useChatStore.getState().editing?.message_id).toBe(mine.message_id);
    expect(box()).toHaveValue('typo here');
    expect(screen.getByText('Editing message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save edit' })).toBeInTheDocument();
  });

  it('ArrowUp does nothing when the box has text or I have no messages', async () => {
    const user = userEvent.setup();
    mount([makeMessage({ seq: 5, sender_user_id: BOB })]);
    await user.click(box());
    await user.keyboard('{ArrowUp}');
    expect(useChatStore.getState().editing).toBeNull();
  });

  it('Save edit sends the new text through the API, not the outbox', async () => {
    const user = userEvent.setup();
    mount([mine]);
    act(() => {
      useChatStore.getState().setEditing(mine);
    });
    await user.clear(box());
    await user.type(box(), 'typo fixed{Enter}');
    expect(api.call).toHaveBeenCalledWith(
      ENDPOINTS.messages.edit,
      expect.objectContaining({ body: { content: like({ text: 'typo fixed' }) } }),
    );
    expect(queued()).toEqual([]);
    await waitFor(() => {
      expect(box()).toHaveValue('');
    });
  });

  it('an empty edit is not saved', async () => {
    const user = userEvent.setup();
    mount([mine]);
    act(() => {
      useChatStore.getState().setEditing(mine);
    });
    await user.clear(box());
    expect(screen.getByRole('button', { name: 'Save edit' })).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(api.call).not.toHaveBeenCalled();
  });

  it('Escape cancels the edit and clears the box', async () => {
    const user = userEvent.setup();
    mount([mine]);
    act(() => {
      useChatStore.getState().setEditing(mine);
    });
    await user.keyboard('{Escape}');
    expect(useChatStore.getState().editing).toBeNull();
    expect(box()).toHaveValue('');
  });

  it('while editing, attachments, polls, GIFs and voice are disabled', () => {
    mount([mine]);
    act(() => {
      useChatStore.getState().setEditing(mine);
    });
    for (const name of [
      'Attach photo or video',
      'Attach file',
      'GIFs and stickers',
      'Create poll',
      'Record voice message',
    ]) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it('an image caption is editable too', () => {
    const photo = makeMessage({
      seq: 6,
      sender_user_id: ME,
      content: {
        type: 'image',
        attachment_id: nextId(),
        width: 1,
        height: 1,
        caption: 'old caption',
      },
    });
    mount([photo]);
    act(() => {
      useChatStore.getState().setEditing(photo);
    });
    expect(box()).toHaveValue('old caption');
  });
});

describe('attachments', () => {
  const pick = (selector: string, file: File) => {
    const input = document.querySelector<HTMLInputElement>(selector)!;
    fireEvent.change(input, { target: { files: [file] } });
  };
  const IMAGE_INPUT = 'input[accept="image/*,video/*"]';
  const FILE_INPUT = 'input[type="file"]:not([accept])';
  const png = () => new File(['x'], 'cat.png', { type: 'image/png' });
  const mp4 = () => new File(['x'], 'clip.mp4', { type: 'video/mp4' });
  const pdf = () => new File(['x'], 'report.pdf', { type: 'application/pdf' });
  const send = () => fireEvent.submit(screen.getByRole('form', { name: 'Send a message' }));

  it('an image shows a preview that can be removed', async () => {
    const user = userEvent.setup();
    mount();
    pick(IMAGE_INPUT, png());
    expect(screen.getByAltText('Selected image preview')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled(); // attachment alone is enough
    await user.click(screen.getByRole('button', { name: 'Remove attachment' }));
    expect(screen.queryByAltText('Selected image preview')).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('a non-image shows its name instead of a preview', () => {
    mount();
    pick(FILE_INPUT, pdf());
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.queryByAltText('Selected image preview')).not.toBeInTheDocument();
  });

  it('a .txt file can be picked and sent as text/plain, even when the browser gives no type', async () => {
    mount();
    pick(FILE_INPUT, new File(['hello'], 'notes.txt', { type: '' }));
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled();
    send();
    await waitFor(() => {
      expect(upload.uploadAttachment).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({ purpose: 'message', mime: 'text/plain', fileName: 'notes.txt' }),
      );
    });
  });

  it.each([
    ['image', IMAGE_INPUT, png, true],
    ['video', IMAGE_INPUT, mp4, true],
    ['file', FILE_INPUT, pdf, false],
  ] as const)('"view once" is offered for %s: %s', (_n, selector, file, offered) => {
    mount();
    pick(selector, file());
    expect(!!screen.queryByLabelText('Send as view once')).toBe(offered);
  });

  it('sends an image: compresses, uploads, queues image content with the caption and view-once', async () => {
    const user = userEvent.setup();
    mount();
    pick(IMAGE_INPUT, png());
    await user.click(screen.getByLabelText('Send as view once'));
    await user.type(box(), 'look');
    send();
    await waitFor(() => {
      expect(queued()).toHaveLength(1);
    });
    expect(compress.prepareImage).toHaveBeenCalled();
    expect(upload.uploadAttachment).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.objectContaining({ purpose: 'message', fileName: 'cat.png' }),
    );
    expect(queued()[0]?.content).toMatchObject({
      type: 'image',
      width: 640,
      height: 480,
      caption: 'look',
      view_once: true,
    });
    await waitFor(() => {
      expect(screen.queryByAltText('Selected image preview')).not.toBeInTheDocument();
    });
    expect(box()).toHaveValue('');
  });

  it('sends a video with its measured size and length', async () => {
    mount();
    pick(IMAGE_INPUT, mp4());
    send();
    await waitFor(() => {
      expect(queued()).toHaveLength(1);
    });
    expect(queued()[0]?.content).toMatchObject({
      type: 'video',
      width: 1280,
      height: 720,
      duration_ms: 4000,
    });
  });

  it('sends a file with its name and size, and never as view-once', async () => {
    mount();
    pick(FILE_INPUT, pdf());
    send();
    await waitFor(() => {
      expect(queued()).toHaveLength(1);
    });
    expect(queued()[0]?.content).toMatchObject({ type: 'file', file_name: 'report.pdf', size: 1 });
    expect(queued()[0]?.content).not.toHaveProperty('view_once');
  });

  it('a reply with an attachment keeps reply_to', async () => {
    mount();
    const original = makeMessage({ seq: 2, sender_user_id: BOB });
    act(() => {
      useChatStore.getState().setReplyingTo(original);
    });
    pick(FILE_INPUT, pdf());
    send();
    await waitFor(() => {
      expect(queued()).toHaveLength(1);
    });
    expect(queued()[0]?.content).toMatchObject({ reply_to: original.message_id });
  });

  it('a failed upload shows the reason with Retry, keeps the attachment, and queues nothing', async () => {
    const user = userEvent.setup();
    upload.uploadAttachment.mockRejectedValueOnce(
      new Error('Upload failed. Check your connection.'),
    );
    mount();
    pick(FILE_INPUT, pdf());
    send();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't upload the file.");
    expect(queued()).toEqual([]);
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(queued()).toHaveLength(1);
    });
    expect(upload.uploadAttachment).toHaveBeenCalledTimes(2);
  });

  it('while uploading, Send is disabled and a second submit does nothing', async () => {
    let finish!: (id: string) => void;
    upload.uploadAttachment.mockImplementationOnce(() => new Promise<string>((r) => (finish = r)));
    mount();
    pick(FILE_INPUT, pdf());
    send();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    });
    send();
    expect(upload.uploadAttachment).toHaveBeenCalledTimes(1);
    finish(nextId());
    await waitFor(() => {
      expect(queued()).toHaveLength(1);
    });
  });

  it('picking nothing (cancelling the chooser) changes nothing', () => {
    mount();
    fireEvent.change(document.querySelector(FILE_INPUT)!, { target: { files: [] } });
    expect(screen.queryByRole('button', { name: 'Remove attachment' })).not.toBeInTheDocument();
  });
});

describe('composer accessibility', () => {
  it('has no violations (plain, with the emoji picker, replying, editing)', async () => {
    const user = userEvent.setup();
    const mine = makeMessage({
      seq: 3,
      sender_user_id: ME,
      content: { type: 'text', text: 'abc' },
    });
    const { container } = mount([mine]);
    await expectNoA11yViolations(container);
    await user.click(screen.getByRole('button', { name: 'Insert emoji' }));
    await expectNoA11yViolations();
    await user.keyboard('{Escape}');
    act(() => {
      useChatStore.getState().setReplyingTo(makeMessage({ seq: 2, sender_user_id: BOB }));
    });
    await expectNoA11yViolations(container);
    act(() => {
      useChatStore.getState().setEditing(mine);
    });
    await expectNoA11yViolations(container);
  });
});
