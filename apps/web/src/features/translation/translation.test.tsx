// "Send in <language>" and voice-note transcripts: what is sent, what the bubble and the chat list
// show, and what the Transcribe / Translate buttons do when the server answers well or badly.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageContent } from '@chat/contracts';
import { ApiError } from '@/lib/api/errors';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { MessageBubble } from '@/features/chat/components/MessageBubble';
import { previewContent } from '@/features/chat/content/registry';
import { buildRows } from '@/features/chat/threadRows';
import { useChatStore } from '@/features/chat/useChatStore';
import {
  CONV,
  ME,
  installFakeServices,
  makeMessage,
  nextId,
  type FakeApi,
} from '../../../test/fakes';
import { SendInLanguage } from './SendInLanguage';
import { TranscriptView } from './TranscriptView';
import { defaultTarget } from './translateTarget';
import { splitForTranslation, translateLong } from './translationApi';

vi.mock('@/features/ai/useAiEnabled', () => ({ useAiEnabled: () => true }));

let api: FakeApi;

/** Answers each endpoint by its path; anything not listed resolves to undefined. */
const answer = (routes: Record<string, (body: never) => unknown>): void => {
  api.call.mockImplementation((...args: unknown[]) => {
    const endpoint = args[0] as { path: string };
    const options = args[1] as { body?: never } | undefined;
    const route = routes[endpoint.path];
    if (!route) return Promise.resolve(undefined);
    try {
      return Promise.resolve(route(options?.body as never));
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
};

/** Echoes every item back with a prefix, like a translation. */
const fakeBatch =
  (prefix: string) =>
  (body: { items: { id: string; text: string }[] }): unknown => ({
    items: body.items.map((i) => ({ id: i.id, text: `${prefix}${i.text}` })),
  });

beforeEach(() => {
  ({ api } = installFakeServices());
  localStorage.clear();
  useChatStore.getState().reset();
  useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
});

const TELUGU = 'నమస్కారం, మీరు ఎలా ఉన్నారు? 😀𝒳';

describe('splitForTranslation', () => {
  it('keeps short text whole and cuts long text at sentence ends under the limit', () => {
    expect(splitForTranslation('hello there')).toEqual(['hello there']);
    const sentence = 'This is one sentence. ';
    const pieces = splitForTranslation(sentence.repeat(400), 3500);
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) {
      expect(p.length).toBeLessThanOrEqual(3500);
      expect(p.endsWith('.')).toBe(true);
    }
    expect(pieces.join(' ').replace(/\s+/g, ' ')).toBe(sentence.repeat(400).trim());
  });

  it('cuts a text with no spaces or full stops at the limit', () => {
    const pieces = splitForTranslation('x'.repeat(8000), 3500);
    expect(pieces.map((p) => p.length)).toEqual([3500, 3500, 1000]);
  });
});

describe('translateLong', () => {
  it('translates every piece and joins them, or returns null when one piece failed', async () => {
    answer({ '/ai/translate-batch': fakeBatch('T:') });
    const long = 'Word. '.repeat(1500);
    const out = await translateLong(long, 'Telugu', CONV);
    expect(out).not.toBeNull();
    expect(out!.split('\n').every((p) => p.startsWith('T:'))).toBe(true);

    answer({
      '/ai/translate-batch': (b: { items: { id: string }[] }) => ({
        items: b.items.map((i, n) => ({ id: i.id, text: n === 0 ? null : 'ok' })),
      }),
    });
    expect(await translateLong(long, 'Telugu', CONV)).toBeNull();
  });
});

describe('Send in another language', () => {
  it('sends the translation as the text and keeps the original, for Telugu and 4-byte characters', async () => {
    answer({ '/ai/translate-batch': () => ({ items: [{ id: 'p0', text: TELUGU }] }) });
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<SendInLanguage text="Hello, how are you?" conversationId={CONV} onSend={onSend} />);
    await user.click(screen.getByRole('button', { name: /Send in another language/ }));
    await user.selectOptions(screen.getByLabelText('Language to send in'), 'Telugu');
    await user.click(screen.getByRole('button', { name: 'Send in Telugu' }));
    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith({
        type: 'text',
        text: TELUGU,
        original_text: 'Hello, how are you?',
        translated_to: 'Telugu',
      });
    });
  });

  it('says why nothing was sent when the translation fails', async () => {
    answer({ '/ai/translate-batch': () => ({ items: [{ id: 'p0', text: null }] }) });
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<SendInLanguage text="Hello" conversationId={CONV} onSend={onSend} />);
    await user.click(screen.getByRole('button', { name: /Send in another language/ }));
    await user.click(screen.getByRole('button', { name: /^Send in / }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Nothing was sent/);
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('a message sent in another language', () => {
  const content: MessageContent = {
    type: 'text',
    text: TELUGU,
    original_text: 'Hello, how are you?',
    translated_to: 'Telugu',
  };

  const draw = (isMine: boolean) => {
    const message = makeMessage({
      seq: 5,
      sender_user_id: isMine ? ME : 'someone-else',
      content,
    });
    const [row] = buildRows([message], [], CONV);
    return render(
      <MessageBubble
        row={row!}
        myId={ME}
        sender={null}
        isGroup={false}
        status="sent"
        quoted={null}
        quotedName=""
        showDate={false}
        onReact={vi.fn()}
        onReply={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
        onDiscard={vi.fn()}
        content={{ onOpenImage: vi.fn() }}
        onJumpTo={vi.fn()}
      />,
    );
  };

  it('shows the sender the translated text with an Original line', () => {
    draw(true);
    expect(screen.getByText(TELUGU)).toBeInTheDocument();
    expect(screen.getByText(/Hello, how are you\?/)).toBeInTheDocument();
    expect(screen.getByText('Original:')).toBeInTheDocument();
  });

  it('shows a reader the translated text, with the original behind a toggle', async () => {
    const user = userEvent.setup();
    draw(false);
    expect(screen.getByText(TELUGU)).toBeInTheDocument();
    expect(screen.queryByText(/Hello, how are you\?/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Show original/ }));
    expect(screen.getByText(/Hello, how are you\?/)).toBeInTheDocument();
  });

  it('previews the translated text in the chat list', () => {
    expect(previewContent(content)).toBe(TELUGU);
  });
});

describe('a video message', () => {
  it('offers no Transcribe or Translate, and asks the server nothing', () => {
    const message = makeMessage({
      seq: 6,
      sender_user_id: 'someone-else',
      content: {
        type: 'video',
        attachment_id: nextId(),
        width: 320,
        height: 240,
        duration_ms: 3000,
      },
    });
    const [row] = buildRows([message], [], CONV);
    render(
      <MessageBubble
        row={row!}
        myId={ME}
        sender={null}
        isGroup={false}
        status="sent"
        quoted={null}
        quotedName=""
        showDate={false}
        onReact={vi.fn()}
        onReply={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onRetry={vi.fn()}
        onDiscard={vi.fn()}
        content={{ onOpenImage: vi.fn() }}
        onJumpTo={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /Transcribe/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Translate/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Translate to')).not.toBeInTheDocument();
    const asked = api.call.mock.calls.map((c) => (c[0] as { path: string }).path);
    expect(asked).not.toContain('/ai/transcript/:attachment_id');
    expect(asked).not.toContain('/ai/transcribe');
  });
});

describe('defaultTarget', () => {
  it('uses the chat language, else the app language, else something other than the note language', () => {
    expect(defaultTarget('Telugu', 'English', null)).toBe('Telugu');
    expect(defaultTarget(null, 'Telugu', null)).toBe('English');
    expect(defaultTarget(null, 'English', null)).toBe('Spanish');
    expect(defaultTarget(null, 'English', 'Hindi')).toBe('Hindi');
    expect(defaultTarget(null, 'Hindi', 'Hindi')).toBe('English');
  });
});

describe('voice note transcript', () => {
  // The view remembers transcripts per attachment, so every test gets its own.
  const draw = () => render(<TranscriptView attachmentId={nextId()} conversationId={CONV} />);

  it('Translate transcribes first, then shows the translation in the picked language', async () => {
    let stored: unknown = { transcript: null };
    answer({
      '/ai/transcript/:attachment_id': () => stored,
      '/ai/transcribe': () => {
        stored = {
          transcript: { text: 'Hello, how are you?', language: 'English', summary: null },
        };
        return { text: 'Hello, how are you?' };
      },
      '/ai/translate-batch': (b: { items: { id: string }[] }) => ({
        items: b.items.map((i) => ({ id: i.id, text: TELUGU })),
      }),
    });
    const user = userEvent.setup();
    draw();
    await user.selectOptions(await screen.findByLabelText('Translate to'), 'Telugu');
    await user.click(screen.getByRole('button', { name: /Translate to Telugu/ }));
    expect(await screen.findByText(TELUGU)).toBeInTheDocument();
    expect(screen.getByText(/Translated from English/)).toBeInTheDocument();
    const batch = api.call.mock.calls.find(
      (c) => (c[0] as { path: string }).path === '/ai/translate-batch',
    );
    const body = (batch?.[1] as { body: { target_language: string; conversation_id: string } })
      .body;
    expect(body.target_language).toBe('Telugu');
    expect(body.conversation_id).toBe(CONV);
  });

  it('tells you when there was no speech instead of showing nothing', async () => {
    answer({
      '/ai/transcript/:attachment_id': () => ({ transcript: null }),
      '/ai/transcribe': () => ({ text: '' }),
    });
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: 'Transcribe' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No speech was found/);
  });

  it('shows the server message when transcription fails', async () => {
    answer({
      '/ai/transcript/:attachment_id': () => ({ transcript: null }),
      '/ai/transcribe': () => {
        throw new ApiError({
          status: 429,
          code: 'RATE_LIMITED',
          message: 'Transcription is busy right now. Try again in a minute.',
        });
      },
    });
    const user = userEvent.setup();
    draw();
    await user.click(await screen.findByRole('button', { name: 'Transcribe' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/busy right now/);
  });

  it('says so when the note is already in the chosen language', async () => {
    answer({
      '/ai/transcript/:attachment_id': () => ({
        transcript: { text: 'Hello there', language: 'English', summary: null },
      }),
      '/ai/translate-batch': (b: { items: { id: string; text: string }[] }) => ({
        items: b.items.map((i) => ({ id: i.id, text: i.text })),
      }),
    });
    const user = userEvent.setup();
    draw();
    await screen.findByLabelText('Transcript');
    await user.selectOptions(screen.getByLabelText('Translate to'), 'English');
    await user.click(screen.getByRole('button', { name: /Translate to English/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already in English/);
  });
});
