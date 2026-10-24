import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FLICK_BOT_USER_ID } from '@chat/contracts';
import { CONV, ME, installFakeServices, makeConversation, makeMessage } from '../../../test/fakes';
import { MessageBubble } from '../chat/components/MessageBubble';
import { buildRows } from '../chat/threadRows';
import * as aiApi from './aiApi';
import { FlickPanel } from './FlickPanel';
import { SuggestReplies } from './SuggestReplies';
import { TranslateButton } from './TranslateButton';
import { resetAiEnabledCache } from './useAiEnabled';

vi.mock('./aiApi', async (importOriginal) => ({
  ...(await importOriginal<typeof aiApi>()),
  getAiEnabled: vi.fn(),
  summarizeUnread: vi.fn(),
  askFlick: vi.fn(),
  suggestReplies: vi.fn(),
  translateText: vi.fn(),
}));
const api = vi.mocked(aiApi);

beforeEach(() => {
  resetAiEnabledCache();
  api.getAiEnabled.mockResolvedValue(true);
});

describe('FlickPanel', () => {
  it('says AI is not configured instead of showing the tools', async () => {
    api.getAiEnabled.mockResolvedValue(false);
    render(<FlickPanel conversation={makeConversation()} open onClose={vi.fn()} />);
    expect(await screen.findByText(/AI is not set up on this server/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Summarize unread' })).not.toBeInTheDocument();
  });

  it('streams a summary into the panel', async () => {
    api.summarizeUnread.mockImplementation((_id, options) => {
      options?.onText?.('- Dinner at 8');
      return Promise.resolve('- Dinner at 8');
    });
    const user = userEvent.setup();
    render(<FlickPanel conversation={makeConversation()} open onClose={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Summarize unread' }));
    expect(await screen.findByText('- Dinner at 8')).toBeInTheDocument();
    expect(api.summarizeUnread).toHaveBeenCalledWith(CONV, expect.anything());
  });

  it('answers a question using this chat as context, and shows errors', async () => {
    api.askFlick.mockResolvedValueOnce('It is at 8.').mockRejectedValueOnce(new Error('boom'));
    const user = userEvent.setup();
    render(<FlickPanel conversation={makeConversation()} open onClose={vi.fn()} />);

    await user.type(await screen.findByLabelText('Ask Flick a question'), 'When is dinner?');
    await user.click(screen.getByRole('button', { name: 'Send question' }));
    expect(await screen.findByText('It is at 8.')).toBeInTheDocument();
    expect(api.askFlick).toHaveBeenCalledWith(
      [{ role: 'user', content: 'When is dinner?' }],
      CONV,
      expect.anything(),
    );

    await user.type(screen.getByLabelText('Ask Flick a question'), 'And after?');
    await user.click(screen.getByRole('button', { name: 'Send question' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Flick could not answer');
  });
});

describe('SuggestReplies', () => {
  it('shows three chips and fills the composer when one is clicked', async () => {
    api.suggestReplies.mockResolvedValue(['Sounds good', 'Not today', 'Maybe later?']);
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<SuggestReplies conversationId={CONV} onPick={onPick} />);

    const button = await screen.findByRole('button', { name: /Suggest replies/ });
    await vi.waitFor(() => {
      expect(button).toBeEnabled();
    });
    await user.click(button);
    await user.click(await screen.findByRole('button', { name: 'Not today' }));
    expect(onPick).toHaveBeenCalledWith('Not today');
  });

  it('is disabled with a note when AI is not configured', async () => {
    api.getAiEnabled.mockResolvedValue(false);
    render(<SuggestReplies conversationId={CONV} onPick={vi.fn()} />);
    expect(await screen.findByText('AI not configured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Suggest replies/ })).toBeDisabled();
  });
});

describe('TranslateButton', () => {
  it('translates into the chosen language', async () => {
    api.translateText.mockResolvedValue('Hello');
    const user = userEvent.setup();
    render(<TranslateButton text="Hola" open onOpenChange={vi.fn()} align="left" />);
    await user.selectOptions(await screen.findByLabelText('Translate to'), 'English');
    expect(await screen.findByText('Hello')).toBeInTheDocument();
    expect(api.translateText).toHaveBeenCalledWith('Hola', 'English');
  });
});

describe('bot messages', () => {
  it('get a Flick badge', () => {
    installFakeServices();
    const [row] = buildRows([makeMessage({ sender_user_id: FLICK_BOT_USER_ID, seq: 2 })], [], CONV);
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
        pickerOpen={false}
        onTogglePicker={vi.fn()}
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
    expect(screen.getAllByText('Flick')).toHaveLength(2); // the name line and the badge
  });
});
