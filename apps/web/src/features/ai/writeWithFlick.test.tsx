// "Describe your message": the bar above the box (write, refine, reply), the inline @flick offer
// and the composer wiring. Drafts go into the box and nothing is ever sent.
import { render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { LIMITS } from '@chat/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { MessageInput } from '@/features/chat/components/MessageInput';
import { useChatStore } from '@/features/chat/useChatStore';
import { useDraftStore } from '@/features/organise/drafts';
import { installFakeServices, makeConversation, ME } from '../../../test/fakes';
import * as aiApi from './aiApi';
import { flickInstruction } from './flickInstruction';
import { resetAiEnabledCache } from './useAiEnabled';
import { DescribeMessageBar } from './DescribeMessageBar';
import { SelectionPolish } from './SelectionPolish';

vi.mock('./aiApi', async (importOriginal) => ({
  ...(await importOriginal<typeof aiApi>()),
  getAiEnabled: vi.fn(),
  composeText: vi.fn(),
  suggestReplies: vi.fn(),
}));
const api = vi.mocked(aiApi);

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  resetAiEnabledCache();
  api.getAiEnabled.mockResolvedValue(true);
  api.composeText.mockResolvedValue({ text: 'Polished text', model: 'Groq · m' });
  useChatStore.getState().reset();
  useDraftStore.setState({ drafts: {} });
  useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
  installFakeServices();
});

describe('flickInstruction', () => {
  it('reads "@flick <instruction>" only', () => {
    expect(flickInstruction("@flick tell Ravi I'll be late")).toBe("tell Ravi I'll be late");
    expect(flickInstruction('  @Flick   hello  ')).toBe('hello');
    expect(flickInstruction('@flick')).toBeNull();
    expect(flickInstruction('@flick   ')).toBeNull();
    expect(flickInstruction('hey @flick do it')).toBeNull();
  });
});

const CHAT_ID = '0190f1a0-0000-7000-8000-000000000001';

/** The bar with a box next to it, the way the composer wires them. */
const Harness = ({ start = '', canReply = false }: { start?: string; canReply?: boolean }) => {
  const [text, setText] = useState(start);
  return (
    <>
      <textarea aria-label="box" value={text} onChange={(e) => setText(e.target.value)} />
      <DescribeMessageBar
        text={text}
        conversationId={CHAT_ID}
        canReply={canReply}
        onSetText={setText}
        onClose={() => undefined}
      />
    </>
  );
};

describe('DescribeMessageBar', () => {
  const setup = (start = '', canReply = false) => {
    render(<Harness start={start} canReply={canReply} />);
    return userEvent.setup();
  };
  const pill = () => screen.findByPlaceholderText('Describe your message');
  const box = () => screen.getByLabelText('box');

  it('Enter writes from the description into the box and sends nothing', async () => {
    const user = setup();
    await user.type(await pill(), "tell Ravi I'll be late{Enter}");
    expect(api.composeText).toHaveBeenCalledWith(
      { mode: 'write', text: "tell Ravi I'll be late" },
      expect.anything(),
    );
    await waitFor(() => {
      expect(box()).toHaveValue('Polished text');
    });
    expect(screen.getByText(/AI can make mistakes/)).toBeInTheDocument();
  });

  it('asks for Insert or Replace when the box had text, and Insert is the default', async () => {
    const user = setup('Hi Ravi');
    await user.type(await pill(), 'say I am late{Enter}');
    await waitFor(() => {
      expect(box()).toHaveValue('Hi Ravi\nPolished text');
    });
    expect(api.composeText).toHaveBeenCalledWith(
      { mode: 'write', text: 'say I am late', draft: 'Hi Ravi' },
      expect.anything(),
    );
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    expect(box()).toHaveValue('Polished text');
    await user.click(screen.getByRole('button', { name: 'Insert' }));
    expect(box()).toHaveValue('Hi Ravi\nPolished text');
  });

  it('a refine chip changes the draft; versions step with the arrows; Undo restores the box', async () => {
    api.composeText
      .mockResolvedValueOnce({ text: 'First draft', model: 'm' })
      .mockResolvedValueOnce({ text: 'Shorter draft', model: 'm' });
    const user = setup();
    await user.type(await pill(), 'greet Ravi{Enter}');
    await waitFor(() => {
      expect(box()).toHaveValue('First draft');
    });
    await user.click(screen.getByRole('button', { name: 'Shorten' }));
    expect(api.composeText).toHaveBeenLastCalledWith(
      { mode: 'refine', text: 'First draft', action: 'shorten' },
      expect.anything(),
    );
    await waitFor(() => {
      expect(box()).toHaveValue('Shorter draft');
    });
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Previous version' }));
    expect(box()).toHaveValue('First draft');
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(box()).toHaveValue('');
    expect(screen.queryByText('1 of 2')).not.toBeInTheDocument();
  });

  it('Translate… offers the language list', async () => {
    const user = setup('hello');
    await user.click(await screen.findByRole('button', { name: 'Translate…' }));
    await user.click(screen.getByRole('menuitem', { name: 'Hindi' }));
    expect(api.composeText).toHaveBeenCalledWith(
      { mode: 'refine', text: 'hello', action: 'translate', language: 'Hindi' },
      expect.anything(),
    );
    await waitFor(() => {
      expect(box()).toHaveValue('Polished text');
    });
  });

  it('Retry asks again and adds another version', async () => {
    const user = setup();
    await user.type(await pill(), 'hi{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(api.composeText).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('2 of 2')).toBeInTheDocument();
  });

  it('"Reply to this…" and the quick chips send the chat id, not chat text', async () => {
    const user = setup('', true);
    await user.click(await screen.findByRole('button', { name: 'Reply to this…' }));
    expect(api.composeText).toHaveBeenCalledWith(
      { mode: 'reply', conversation_id: CHAT_ID },
      expect.anything(),
    );
    await waitFor(() => {
      expect(box()).toHaveValue('Polished text');
    });
  });

  it('the quick chip adds a hint; tone and length settings are sent and remembered', async () => {
    const user = setup('', true);
    await user.click(await screen.findByRole('button', { name: 'Tone and length' }));
    await user.click(screen.getByRole('button', { name: 'Formal' }));
    await user.click(screen.getByRole('button', { name: 'Shorter' }));
    expect(JSON.parse(localStorage.getItem('flick.compose.prefs')!)).toEqual({
      tone: 'formal',
      length: 'shorter',
    });
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Decline politely' }));
    expect(api.composeText).toHaveBeenCalledWith(
      {
        mode: 'reply',
        conversation_id: CHAT_ID,
        text: 'Decline politely',
        tone: 'formal',
        length: 'shorter',
      },
      expect.anything(),
    );
  });

  it('keeps the last five prompts as chips when the field is empty', async () => {
    const user = setup();
    await user.type(await pill(), 'one{Enter}');
    await waitFor(() => {
      expect(box()).toHaveValue('Polished text');
    });
    expect(JSON.parse(localStorage.getItem('flick.compose.prompts')!)).toEqual(['one']);
  });

  it('shows the error, including the rate limit, with a way to try again', async () => {
    api.composeText.mockRejectedValue(
      new ApiError({ status: 429, code: 'RATE_LIMITED', message: 'Too many AI requests.' }),
    );
    const user = setup();
    await user.type(await pill(), 'hi{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many AI requests.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('refuses text over the message limit and says AI is off when it is', async () => {
    const { unmount } = render(<Harness start={'a'.repeat(LIMITS.MAX_TEXT_LENGTH + 1)} />);
    expect(await screen.findByRole('button', { name: 'Shorten' })).toBeDisabled();
    expect(screen.getByText(/too long to improve/)).toBeInTheDocument();
    unmount();
    resetAiEnabledCache();
    api.getAiEnabled.mockResolvedValue(false);
    render(<Harness start="x" />);
    expect(await screen.findByText('AI is not set up on this server.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shorten' })).toBeDisabled();
  });

  it('Escape and the close button close it', async () => {
    const onClose = vi.fn();
    render(
      <DescribeMessageBar
        text=""
        conversationId={CHAT_ID}
        canReply={false}
        onSetText={vi.fn()}
        onClose={onClose}
      />,
    );
    const user = userEvent.setup();
    await user.click(await pill());
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Close Write with Flick' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('SelectionPolish', () => {
  it('Polish and Rewrite hand back only the selection result', async () => {
    const onReplace = vi.fn();
    render(<SelectionPolish selected="helo wrld" onReplace={onReplace} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Polish' }));
    expect(api.composeText).toHaveBeenCalledWith(
      { mode: 'polish', text: 'helo wrld' },
      expect.anything(),
    );
    await waitFor(() => {
      expect(onReplace).toHaveBeenCalledWith('Polished text');
    });
    await user.click(screen.getByRole('button', { name: 'Rewrite' }));
    await user.click(screen.getByRole('menuitem', { name: 'Formal' }));
    expect(api.composeText).toHaveBeenLastCalledWith(
      { mode: 'rewrite', text: 'helo wrld', tone: 'formal' },
      expect.anything(),
    );
  });
});

describe('in the composer', () => {
  const mount = (conversation = makeConversation()) => {
    render(<MessageInput conversation={conversation} messages={[]} />);
    return userEvent.setup();
  };
  const box = () => screen.getByPlaceholderText('Type a message…');

  it('the button opens the bar (highlighted), a description writes into the box, and it closes', async () => {
    const user = mount();
    const button = await screen.findByRole('button', { name: 'Write with Flick' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await user.type(screen.getByPlaceholderText('Describe your message'), 'say hi{Enter}');
    await waitFor(() => {
      expect(box()).toHaveValue('Polished text');
    });
    await user.click(screen.getByRole('button', { name: 'Close Write with Flick' }));
    expect(screen.queryByRole('group', { name: 'Describe your message' })).not.toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(box()).toHaveValue('Polished text');
  });

  it('Ctrl+J toggles the bar', async () => {
    const user = mount();
    await screen.findByRole('button', { name: 'Write with Flick' });
    await user.keyboard('{Control>}j{/Control}');
    expect(screen.getByRole('group', { name: 'Describe your message' })).toBeInTheDocument();
    await user.keyboard('{Control>}j{/Control}');
    expect(screen.queryByRole('group', { name: 'Describe your message' })).not.toBeInTheDocument();
  });

  it('a description is added after what is already typed', async () => {
    const user = mount();
    await user.type(box(), 'Hi Ravi');
    await user.click(await screen.findByRole('button', { name: 'Write with Flick' }));
    await user.type(screen.getByPlaceholderText('Describe your message'), 'say I am late{Enter}');
    await waitFor(() => {
      expect(box()).toHaveValue('Hi Ravi\nPolished text');
    });
  });

  it('the button is not offered when the server has no AI', async () => {
    api.getAiEnabled.mockResolvedValue(false);
    mount();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Write with Flick' })).not.toBeInTheDocument();
    });
  });

  it('"@flick <instruction>" in a 1:1 chat offers to write it, filling the box', async () => {
    const user = mount();
    await user.type(box(), "@flick tell Ravi I'll be late");
    await user.click(await screen.findByRole('button', { name: 'Write this with Flick' }));
    expect(api.composeText).toHaveBeenCalledWith(
      { mode: 'write', text: "tell Ravi I'll be late" },
      expect.anything(),
    );
    await waitFor(() => {
      expect(box()).toHaveValue('Polished text');
    });
    expect(screen.queryByRole('button', { name: 'Write this with Flick' })).not.toBeInTheDocument();
  });

  it('no inline offer in a group, or without an instruction', async () => {
    const user = mount(makeConversation({ type: 'group', title: 'Team', peer: null }));
    await user.type(box(), '@flick hello');
    expect(screen.queryByRole('button', { name: 'Write this with Flick' })).not.toBeInTheDocument();
  });

  it('phone "+" panel has a Write with Flick tile that opens the bar', async () => {
    const user = mount();
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Write with Flick' }));
    expect(screen.getByRole('group', { name: 'Describe your message' })).toBeInTheDocument();
  });
});
