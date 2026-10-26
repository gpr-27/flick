// AI surfaces: model labels, the one-request-at-a-time task machine, and the panel,
// translate and suggest screens in their less happy states.
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { CONV, makeConversation } from '../../../test/fakes';
import { expectNoA11yViolations } from '../../../test/a11y';
import * as aiApi from './aiApi';
import { FlickPanel } from './FlickPanel';
import { isFlickBot } from './isFlickBot';
import { LANGUAGES } from './languages';
import { modelLabel } from './modelLabel';
import { ModelTag } from './ModelTag';
import { SuggestReplies } from './SuggestReplies';
import { TranslateDialog } from './TranslateDialog';
import { resetAiEnabledCache } from './useAiEnabled';
import { useAiTask } from './useAiTask';

vi.mock('./aiApi', async (importOriginal) => ({
  ...(await importOriginal<typeof aiApi>()),
  getAiEnabled: vi.fn(),
  summarizeUnread: vi.fn(),
  askFlick: vi.fn(),
  suggestReplies: vi.fn(),
  translateText: vi.fn(),
}));
const api = vi.mocked(aiApi);
const notConfigured = () =>
  new ApiError({ status: 503, code: 'AI_UNAVAILABLE', message: 'AI is not configured' });

beforeEach(() => {
  resetAiEnabledCache();
  api.getAiEnabled.mockResolvedValue(true);
});

describe('model labels', () => {
  it.each([
    ['anthropic', 'claude-haiku-5-5', 'Anthropic · claude-haiku-5-5'],
    ['groq', 'gpt-oss-120b', 'Groq · gpt-oss-120b'],
    ['gemini', 'gemini-3.8-flash', 'Gemini · gemini-3.8-flash'],
    ['someone-new', 'x-1', 'someone-new · x-1'],
    ['', 'bare-model', ' · bare-model'],
  ])('%s + %s -> %s', (provider, model, label) => {
    expect(modelLabel(provider, model)).toBe(label);
  });

  it('the tag says "Answered by" and renders nothing without a label', () => {
    const { container, rerender } = render(<ModelTag label="Groq · m" />);
    expect(container).toHaveTextContent('Answered by Groq · m');
    rerender(<ModelTag label={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('the bot is recognised by its fixed id or by the bot flag, never by name', () => {
    expect(isFlickBot('00000000-0000-4000-8000-00000000f11c', null)).toBe(true);
    expect(
      isFlickBot('someone', {
        id: 'someone',
        username: 'flick',
        display_name: 'Flick',
        avatar_url: null,
        is_bot: false,
      }),
    ).toBe(false);
    expect(
      isFlickBot('someone', {
        id: 'someone',
        username: 'x',
        display_name: 'x',
        avatar_url: null,
        is_bot: true,
      }),
    ).toBe(true);
    expect(isFlickBot(null, null)).toBe(false);
  });

  it('offers a sensible language list', () => {
    expect(LANGUAGES.length).toBeGreaterThan(5);
    expect(new Set(LANGUAGES).size).toBe(LANGUAGES.length);
    expect(LANGUAGES).toContain('English');
  });
});

describe('useAiTask', () => {
  it('goes idle -> loading -> done, streaming text and the model', async () => {
    const { result } = renderHook(() => useAiTask());
    expect(result.current.state.status).toBe('idle');
    let text: string | null = null;
    await act(async () => {
      text = await result.current.run(({ onText, onModel }) => {
        onModel('Groq · m');
        onText('partial');
        return Promise.resolve('final');
      });
    });
    expect(text).toBe('final');
    expect(result.current.state).toMatchObject({
      status: 'done',
      text: 'final',
      model: 'Groq · m',
    });
    expect(result.current.lastModel.current).toBe('Groq · m');
  });

  it('a failure becomes an error message; a 503 "not configured" is flagged', async () => {
    const { result } = renderHook(() => useAiTask());
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error('boom')));
    });
    expect(result.current.state).toMatchObject({
      status: 'error',
      error: 'Flick could not answer. Try again.',
      notConfigured: false,
    });
    await act(async () => {
      await result.current.run(() => Promise.reject(notConfigured()));
    });
    expect(result.current.state).toMatchObject({ status: 'error', notConfigured: true });
  });

  it('a newer run cancels the older one, whose late answer is ignored', async () => {
    const { result } = renderHook(() => useAiTask());
    let release!: (s: string) => void;
    let firstSignal!: AbortSignal;
    let first!: Promise<string | null>;
    act(() => {
      first = result.current.run(
        ({ signal }) =>
          new Promise<string>((resolve) => {
            firstSignal = signal;
            release = resolve;
          }),
      );
    });
    await act(async () => {
      await result.current.run(() => Promise.resolve('second'));
    });
    expect(firstSignal.aborted).toBe(true);
    await act(async () => {
      release('first');
      expect(await first).toBeNull();
    });
    expect(result.current.state).toMatchObject({ status: 'done', text: 'second' });
  });

  it('unmounting cancels the request in flight', () => {
    const { result, unmount } = renderHook(() => useAiTask());
    let signal!: AbortSignal;
    act(() => {
      void result.current.run(({ signal: s }) => {
        signal = s;
        return new Promise<string>(() => undefined);
      });
    });
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it('reset goes back to idle', async () => {
    const { result } = renderHook(() => useAiTask());
    await act(async () => {
      await result.current.run(() => Promise.resolve('x'));
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.state.status).toBe('idle');
  });
});

describe('Ask Flick panel', () => {
  const open = () =>
    render(<FlickPanel conversation={makeConversation()} open onClose={vi.fn()} />);

  it('shows a spinner while it checks whether AI is available', () => {
    api.getAiEnabled.mockReturnValue(new Promise(() => undefined));
    open();
    expect(screen.getByRole('status', { name: /Checking AI/i })).toBeInTheDocument();
  });

  it('a summary that fails because AI is off says so, not "try again"', async () => {
    const user = userEvent.setup();
    api.summarizeUnread.mockRejectedValue(notConfigured());
    open();
    await user.click(await screen.findByRole('button', { name: 'Summarize unread' }));
    expect(await screen.findByText(/AI is not set up on this server yet/)).toBeInTheDocument();
  });

  it('keeps the conversation: question, answer with its model, then a follow-up with the history', async () => {
    const user = userEvent.setup();
    api.askFlick.mockImplementation((_turns, _id, options) => {
      options?.onModel?.('Anthropic · claude-haiku-5-5');
      return Promise.resolve('It is at 8.');
    });
    open();
    await user.type(await screen.findByLabelText('Ask Flick a question'), 'When?');
    await user.click(screen.getByRole('button', { name: 'Send question' }));
    expect(await screen.findByText('It is at 8.')).toBeInTheDocument();
    expect(screen.getByText('Answered by Anthropic · claude-haiku-5-5')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Ask Flick a question'), 'Where?');
    await user.click(screen.getByRole('button', { name: 'Send question' }));
    await waitFor(() => {
      expect(api.askFlick).toHaveBeenCalledTimes(2);
    });
    expect(api.askFlick.mock.calls[1]![0]).toEqual([
      { role: 'user', content: 'When?' },
      { role: 'assistant', content: 'It is at 8.' },
      { role: 'user', content: 'Where?' },
    ]);
  });

  it('only the latest 20 turns are sent', async () => {
    const user = userEvent.setup();
    api.askFlick.mockResolvedValue('ok');
    open();
    const field = await screen.findByLabelText('Ask Flick a question');
    for (let i = 0; i < 12; i++) {
      await user.type(field, `q${i}`);
      await user.click(screen.getByRole('button', { name: 'Send question' }));
      await waitFor(() => {
        expect(api.askFlick).toHaveBeenCalledTimes(i + 1);
      });
      await screen.findAllByText('ok');
    }
    expect(api.askFlick.mock.calls.at(-1)![0]).toHaveLength(20);
  });

  it('the "read this chat" checkbox controls whether the chat id is sent', async () => {
    const user = userEvent.setup();
    api.askFlick.mockResolvedValue('ok');
    open();
    await user.click(
      await screen.findByRole('checkbox', { name: /Let Flick read the latest messages/ }),
    );
    await user.type(screen.getByLabelText('Ask Flick a question'), 'hi');
    await user.click(screen.getByRole('button', { name: 'Send question' }));
    await waitFor(() => {
      expect(api.askFlick).toHaveBeenCalledWith(
        [{ role: 'user', content: 'hi' }],
        undefined,
        expect.anything(),
      );
    });
  });

  it('Send is disabled for blank text', async () => {
    const user = userEvent.setup();
    open();
    await user.type(await screen.findByLabelText('Ask Flick a question'), '   ');
    expect(screen.getByRole('button', { name: 'Send question' })).toBeDisabled();
  });

  it('has no accessibility violations', async () => {
    open();
    await screen.findByRole('button', { name: 'Summarize unread' });
    await expectNoA11yViolations();
  });
});

describe('Translate dialog', () => {
  it('shows the translation with the model, and an error with the reason', async () => {
    const user = userEvent.setup();
    api.translateText
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce({ text: 'Bonjour', model: 'Groq · m' });
    render(<TranslateDialog text="Hello" open onClose={vi.fn()} />);
    const select = await screen.findByLabelText('Translate to');
    await user.selectOptions(select, 'French');
    expect(await screen.findByRole('alert')).toHaveTextContent('Flick could not answer');
    await user.selectOptions(select, 'German');
    expect(await screen.findByText('Bonjour')).toBeInTheDocument();
    expect(screen.getByText('Answered by Groq · m')).toBeInTheDocument();
  });

  it('says AI is not set up, with nothing to choose', async () => {
    api.getAiEnabled.mockResolvedValue(false);
    render(<TranslateDialog text="Hello" open onClose={vi.fn()} />);
    expect(await screen.findByText('AI is not set up on this server.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Translate to')).not.toBeInTheDocument();
  });

  it('Close calls onClose; the dialog is named', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TranslateDialog text="Hello" open onClose={onClose} />);
    await user.click(await screen.findByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Translate message' })).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    render(<TranslateDialog text="Hello" open onClose={vi.fn()} />);
    await screen.findByLabelText('Translate to');
    await expectNoA11yViolations();
  });
});

describe('Suggest replies', () => {
  it('a failure shows a message and the button can be tried again', async () => {
    const user = userEvent.setup();
    api.suggestReplies
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce({ replies: ['Yes'], model: 'Groq · m' });
    render(<SuggestReplies conversationId={CONV} onPick={vi.fn()} />);
    const button = screen.getByRole('button', { name: /Suggest replies/ });
    await waitFor(() => {
      expect(button).toBeEnabled();
    });
    await user.click(button);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not get suggestions.');
    await user.click(button);
    expect(await screen.findByRole('button', { name: 'Yes' })).toBeInTheDocument();
  });

  it('picking a suggestion clears the chips', async () => {
    const user = userEvent.setup();
    api.suggestReplies.mockResolvedValue({ replies: ['Yes', 'No'], model: 'Groq · m' });
    render(<SuggestReplies conversationId={CONV} onPick={vi.fn()} />);
    const button = screen.getByRole('button', { name: /Suggest replies/ });
    await waitFor(() => {
      expect(button).toBeEnabled();
    });
    await user.click(button);
    await user.click(await screen.findByRole('button', { name: 'Yes' }));
    expect(screen.queryByRole('button', { name: 'No' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Answered by/)).not.toBeInTheDocument();
  });

  it('on phones the chip row scrolls sideways instead of wrapping (class convention)', () => {
    const { container } = render(<SuggestReplies conversationId={CONV} onPick={vi.fn()} />);
    expect(container.firstElementChild?.firstElementChild).toHaveClass(
      'max-sm:overflow-x-auto',
      'sm:flex-wrap',
    );
  });
});
