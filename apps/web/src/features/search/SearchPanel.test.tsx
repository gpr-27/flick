import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ENDPOINTS } from '@chat/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { CONV, installFakeServices, makeConversation, makeMessage } from '../../../test/fakes';
import { useChatStore } from '../chat/useChatStore';
import { useJumpStore } from '../organise/jump';
import { MentionText } from '../organise/MentionViews';
import { SearchPanel } from './SearchPanel';
import { parseSnippet } from './parseSnippet';

beforeEach(() => {
  useChatStore.getState().reset();
  useJumpStore.setState({ target: null, flashId: null });
});

const search = async (snippet: string) => {
  const user = userEvent.setup();
  const { api } = installFakeServices();
  const hit = { message: makeMessage({ seq: 7 }), snippet };
  api.call.mockResolvedValue({ items: [hit], next_cursor: null });
  const conv = makeConversation();
  useChatStore.setState({ conversations: { [conv.id]: conv } });
  render(<SearchPanel open onClose={() => undefined} />);
  await user.type(screen.getByRole('searchbox'), 'plan{Enter}');
  return { user, api, hit };
};

describe('search', () => {
  it('sends the query to GET /search and lists the results', async () => {
    const { api } = await search('the <mark>plan</mark> is set');
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.messages.search, { query: { q: 'plan' } });
    const results = await screen.findByRole('list', { name: 'Search results' });
    expect(within(results).getByText('plan').tagName).toBe('MARK');
  });

  it('renders only <mark> as markup and everything else as text', async () => {
    await search(
      '<mark>plan</mark> &lt;script&gt;alert(1)&lt;/script&gt; <img src=x onerror=alert(1)>',
    );
    const results = await screen.findByRole('list', { name: 'Search results' });
    expect(results.querySelectorAll('mark')).toHaveLength(1);
    expect(results.querySelector('script')).toBeNull();
    expect(results.querySelector('img')).toBeNull();
    expect(results).toHaveTextContent('<script>alert(1)</script>');
    expect(results).toHaveTextContent('<img src=x onerror=alert(1)>');
  });

  it('clicking a result opens the chat and asks to jump to that message', async () => {
    const { user, hit } = await search('a <mark>plan</mark>');
    await user.click(await screen.findByRole('button', { name: /plan/ }));
    expect(useChatStore.getState().selectedId).toBe(CONV);
    expect(useJumpStore.getState().target).toEqual({
      conversationId: CONV,
      messageId: hit.message.message_id,
      seq: 7,
    });
  });

  it('shows a message when nothing matches', async () => {
    const user = userEvent.setup();
    const { api } = installFakeServices();
    api.call.mockResolvedValue({ items: [], next_cursor: null });
    render(<SearchPanel open onClose={() => undefined} />);
    await user.type(screen.getByRole('searchbox'), 'zzz{Enter}');
    expect(await screen.findByText('No messages found')).toBeInTheDocument();
  });

  it('parseSnippet keeps marks and decodes entities', () => {
    expect(parseSnippet('a <mark>b</mark> &amp; c')).toEqual([
      { text: 'a ', marked: false },
      { text: 'b', marked: true },
      { text: ' & c', marked: false },
    ]);
  });
});

describe('mention highlighting', () => {
  it('highlights known usernames only', () => {
    const { container } = render(
      <MentionText text="hi @bob and @nobody" known={new Set(['bob'])} />,
    );
    const marked = [...container.querySelectorAll('span.font-semibold')];
    expect(marked.map((m) => m.textContent)).toEqual(['@bob']);
    expect(container).toHaveTextContent('hi @bob and @nobody');
  });

  it('leaves plain text untouched', () => {
    const { container } = render(<MentionText text="no mentions <b>" known={new Set(['bob'])} />);
    expect(container.innerHTML).toBe('no mentions &lt;b&gt;');
  });
});
