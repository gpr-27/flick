// Phone layout: the controls that fold into the "+" (composer) and "⋮" (chat header) menus.
// jsdom has no layout, so both the inline and the menu versions are in the DOM; these tests
// check the menu versions are wired to the same behaviour.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { useCallStore } from '@/features/calls/useCallStore';
import { installFakeServices, makeConversation, ME } from '../../../../test/fakes';
import { useChatStore } from '../useChatStore';
import { ChatHeader } from './ChatHeader';
import { MessageInput } from './MessageInput';

beforeEach(() => {
  localStorage.clear();
  useChatStore.getState().reset();
  useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
  installFakeServices();
});

describe('composer "+" menu', () => {
  const open = async () => {
    const user = userEvent.setup();
    render(<MessageInput conversation={makeConversation()} messages={[]} />);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    return user;
  };

  it('lists every secondary action', async () => {
    await open();
    const menu = screen.getByRole('menu', { name: 'More actions' });
    const names = within(menu)
      .getAllByRole('menuitem')
      .map((i) => i.textContent);
    expect(names).toEqual(['Emoji', 'Photo or video', 'File', 'GIFs and stickers', 'Poll']);
  });

  it('Emoji opens the emoji picker', async () => {
    const user = await open();
    await user.click(screen.getByRole('menuitem', { name: 'Emoji' }));
    expect(screen.getByRole('dialog', { name: 'Emoji picker' })).toBeInTheDocument();
  });

  it('Poll opens the poll composer', async () => {
    const user = await open();
    await user.click(screen.getByRole('menuitem', { name: 'Poll' }));
    expect(await screen.findByRole('button', { name: 'Send poll' })).toBeInTheDocument();
  });

  it('Photo or video opens the file chooser', async () => {
    const user = await open();
    const input = document.querySelector<HTMLInputElement>('input[accept="image/*,video/*"]');
    const click = vi.spyOn(input as HTMLInputElement, 'click');
    await user.click(screen.getByRole('menuitem', { name: 'Photo or video' }));
    expect(click).toHaveBeenCalled();
  });

  it('Escape closes the menu', async () => {
    const user = await open();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'More actions' })).not.toBeInTheDocument();
  });
});

describe('chat header "⋮" menu on phones', () => {
  const conversation = makeConversation();

  const open = async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ChatHeader conversation={conversation} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Chat options' }));
    return { user, menu: screen.getByRole('menu', { name: 'Chat options' }) };
  };

  it('holds the timer, video call and Ask Flick', async () => {
    const { menu } = await open();
    expect(
      within(menu).getByRole('menuitem', { name: 'Disappearing messages: Off' }),
    ).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Video call' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Ask Flick' })).toBeInTheDocument();
  });

  it('Video call starts a video call with the peer', async () => {
    const initiateCall = vi.fn();
    useCallStore.setState({ initiateCall } as never);
    const { user, menu } = await open();
    await user.click(within(menu).getByRole('menuitem', { name: 'Video call' }));
    expect(initiateCall).toHaveBeenCalledWith(conversation.id, conversation.peer, 'video');
  });

  it('the timer item opens the disappearing-messages dialog', async () => {
    const { user, menu } = await open();
    await user.click(within(menu).getByRole('menuitem', { name: /Disappearing messages/ }));
    expect(await screen.findByRole('radiogroup', { name: 'Timer' })).toBeInTheDocument();
  });

  it('Ask Flick opens the assistant panel', async () => {
    const { user, menu } = await open();
    await user.click(within(menu).getByRole('menuitem', { name: 'Ask Flick' }));
    expect(await screen.findByRole('heading', { name: 'Ask Flick' })).toBeInTheDocument();
  });

  it('Escape closes the menu', async () => {
    const { user } = await open();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Chat options' })).not.toBeInTheDocument();
  });
});
