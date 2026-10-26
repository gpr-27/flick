import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FLICK_BOT_USER_ID, type MessageRecord } from '@chat/contracts';
import { CONV, ME, installFakeServices, makeMessage } from '../../../../test/fakes';
import { useAiEnabled } from '../useAiEnabled';
import { FlickChatTools } from './FlickChatTools';
import * as flickApi from './flickApi';
import { speakableText, useFollowupSetting } from './flickSettings';
import MemoryPage from './MemoryPage';
import { searchTopics, topicStartingAt } from './useFlickTopics';

vi.mock('./flickApi');
vi.mock('../useAiEnabled');
const useAiEnabledMock = vi.mocked(useAiEnabled);
const api = vi.mocked(flickApi);

const topic = (id: string, title: string, seq: number) => ({
  id,
  title,
  started_message_seq: seq,
  created_at: '2026-01-01T00:00:00.000Z',
});

describe('topics', () => {
  const topics = [topic('b', 'Trip to Goa', 20), topic('a', 'Taxes', 5)];
  it('puts the divider above the first message of a topic', () => {
    expect(topicStartingAt(topics, 4, 5)?.id).toBe('a');
    expect(topicStartingAt(topics, 10, 21)?.id).toBe('b'); // the exact seq was not shown
    expect(topicStartingAt(topics, 5, 6)).toBeUndefined();
  });
  it('searches by title', () => {
    expect(searchTopics(topics, 'goa').map((t) => t.id)).toEqual(['b']);
    expect(searchTopics(topics, '')).toHaveLength(2);
  });
});

describe('read aloud text', () => {
  it('drops markdown, code and links', () => {
    expect(speakableText('**Hi** see https://x.com\n```js\nx()\n```')).toBe(
      'Hi see link code block.',
    );
  });
});

describe('Memory page', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.listMemories.mockResolvedValue([
      { id: 'm1', fact: 'Is vegetarian', created_at: '2026-01-01T00:00:00.000Z' },
    ]);
  });

  it('lists, edits and deletes a memory', async () => {
    api.updateMemory.mockResolvedValue({
      id: 'm1',
      fact: 'Is vegan',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    api.deleteMemory.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <MemoryPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Is vegetarian')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit: Is vegetarian' }));
    const input = screen.getByLabelText('Edit memory');
    await user.clear(input);
    await user.type(input, 'Is vegan');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Is vegan')).toBeInTheDocument();
    expect(api.updateMemory).toHaveBeenCalledWith('m1', 'Is vegan');
    await user.click(screen.getByRole('button', { name: 'Delete: Is vegan' }));
    await waitFor(() => {
      expect(screen.queryByText('Is vegan')).not.toBeInTheDocument();
    });
    expect(api.deleteMemory).toHaveBeenCalledWith('m1');
  });

  it('forgets everything after a confirmation', async () => {
    api.clearMemories.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <MemoryPage />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Forget everything' }));
    expect(api.clearMemories).toHaveBeenCalled();
    expect(await screen.findByText('Flick has not remembered anything yet.')).toBeInTheDocument();
  });
});

describe('follow-up suggestions', () => {
  const reply = (over: Partial<MessageRecord> = {}) =>
    makeMessage({
      sender_user_id: FLICK_BOT_USER_ID,
      content: { type: 'text', text: 'Here you go' },
      created_at: new Date().toISOString(),
      ...over,
    });
  const tools = (messages: MessageRecord[]) => (
    <MemoryRouter>
      <FlickChatTools conversationId={CONV} myId={ME} messages={messages} />
    </MemoryRouter>
  );

  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    installFakeServices();
    useAiEnabledMock.mockReturnValue(true);
    api.listTopics.mockResolvedValue([]);
    api.getSpeed.mockResolvedValue('quality');
    api.getFollowups.mockResolvedValue(['Tell me more']);
  });

  it('are off by default', () => {
    expect(localStorage.getItem('flick.followups')).toBeNull();
    const Probe = () => <span>{String(useFollowupSetting()[0])}</span>;
    render(<Probe />);
    expect(screen.getByText('false')).toBeInTheDocument();
  });

  it('make no AI call when the chat opens, even with the setting on', async () => {
    localStorage.setItem('flick.followups', '1');
    render(tools([reply()]));
    await waitFor(() => {
      expect(api.getSpeed).toHaveBeenCalled();
    });
    expect(api.getFollowups).not.toHaveBeenCalled();
  });

  it('are fetched once for a new reply when the setting is on', async () => {
    localStorage.setItem('flick.followups', '1');
    const first = reply();
    const { rerender } = render(tools([first]));
    const second = reply();
    rerender(tools([first, second]));
    expect(await screen.findByText('Tell me more')).toBeInTheDocument();
    rerender(tools([first, second]));
    expect(api.getFollowups).toHaveBeenCalledTimes(1);
    expect(api.getFollowups).toHaveBeenCalledWith(second.message_id);
  });

  it('are not fetched for a new reply when the setting is off', async () => {
    const first = reply();
    const { rerender } = render(tools([first]));
    rerender(tools([first, reply()]));
    await waitFor(() => {
      expect(api.getSpeed).toHaveBeenCalled();
    });
    expect(api.getFollowups).not.toHaveBeenCalled();
  });
});
