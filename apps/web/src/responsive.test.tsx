// Responsive behaviour. The phone/laptop split is Tailwind classes (`max-sm:` / `sm:`), which
// jsdom does not evaluate, so these tests read the class conventions: for each viewport they
// ask which controls are present (not hidden by their own or an ancestor's classes).
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/clerk-react', () => ({ UserButton: () => <button type="button">Account</button> }));

import { Navbar } from '@/components/app/Navbar';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { ChatHeader } from '@/features/chat/components/ChatHeader';
import { MessageInput } from '@/features/chat/components/MessageInput';
import { MessageMenu } from '@/features/chat/components/MessageMenu';
import { HomePage } from '@/features/chat/HomePage';
import { useChatStore } from '@/features/chat/useChatStore';
import { useInstallStore } from '@/pwa/install';
import { installFakeServices, makeConversation, ME } from '../test/fakes';
import { installListLayout } from '../test/layout';
import { isHiddenOn, isVisibleOn, mockViewport, type Viewport } from '../test/viewport';

let restoreLayout: () => void;
beforeAll(() => {
  restoreLayout = installListLayout();
});
afterAll(() => {
  restoreLayout();
});

beforeEach(() => {
  localStorage.clear();
  installFakeServices();
  useChatStore.getState().reset();
  useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
  useInstallStore.setState({ event: null, installed: false });
});

const on = (viewport: Viewport, el: Element | null): boolean => !!el && isVisibleOn(el, viewport);
const byName = (name: string | RegExp) => screen.queryByRole('button', { name });

describe('the class-convention helper itself', () => {
  const el = (cls: string) => {
    const node = document.createElement('div');
    node.className = cls;
    return node;
  };
  // [classes, hidden on phone, hidden on laptop]
  const table: [string, boolean, boolean][] = [
    ['', false, false],
    ['max-sm:hidden', true, false],
    ['sm:hidden', false, true],
    ['hidden sm:flex', true, false],
    ['hidden sm:inline', true, false],
    ['hidden', true, true],
    ['hidden sm:block', true, false],
    ['flex', false, false],
    ['sr-only sm:hidden', false, true],
  ];
  it.each(table)('"%s"', (cls, phone, laptop) => {
    expect(isHiddenOn(el(cls), 'phone')).toBe(phone);
    expect(isHiddenOn(el(cls), 'laptop')).toBe(laptop);
  });

  it('an ancestor that hides the element hides it too', () => {
    const parent = el('max-sm:hidden');
    const child = el('');
    parent.append(child);
    expect(isHiddenOn(child, 'phone')).toBe(true);
    expect(isHiddenOn(child, 'laptop')).toBe(false);
  });

  it('mockViewport answers matchMedia like a phone or a laptop', () => {
    mockViewport('phone');
    expect(window.matchMedia('(min-width: 640px)').matches).toBe(false);
    expect(window.matchMedia('(pointer: coarse)').matches).toBe(true);
    expect(window.innerWidth).toBe(390);
    mockViewport('laptop');
    expect(window.matchMedia('(min-width: 640px)').matches).toBe(true);
    expect(window.matchMedia('(hover: hover)').matches).toBe(true);
    expect(window.innerWidth).toBe(1280);
  });
});

describe('navbar', () => {
  const renderNav = () =>
    render(
      <MemoryRouter>
        <Navbar />
      </MemoryRouter>,
    );

  it('phone: Calls, the More menu and the account; settings, profile and theme are inside the menu', () => {
    renderNav();
    expect(on('phone', screen.getByRole('link', { name: /Calls/ }))).toBe(true);
    expect(on('phone', byName('More'))).toBe(true);
    expect(on('phone', screen.getByRole('link', { name: 'Settings' }))).toBe(false);
    expect(on('phone', screen.getByRole('link', { name: /Profile/ }))).toBe(false);
    expect(on('phone', byName(/Switch to (dark|light) mode/))).toBe(false);
  });

  it('laptop: everything inline and no More menu', () => {
    renderNav();
    expect(on('laptop', screen.getByRole('link', { name: 'Settings' }))).toBe(true);
    expect(on('laptop', screen.getByRole('link', { name: /Profile/ }))).toBe(true);
    expect(on('laptop', byName(/Switch to (dark|light) mode/))).toBe(true);
    expect(on('laptop', byName('More'))).toBe(false);
  });

  it('the install button is inline on laptops only; phones get it in the menu', () => {
    useInstallStore.setState({ event: new Event('beforeinstallprompt') as never });
    renderNav();
    const install = screen.getAllByRole('button', { name: /Install app/ })[0]!;
    expect(on('laptop', install)).toBe(true);
    expect(on('phone', install)).toBe(false);
  });

  it('the tagline is for laptops only; Calls and Profile show a word on laptops and an sr-only name on phones', () => {
    renderNav();
    const tagline = screen.getByText('realtime messaging');
    expect(on('laptop', tagline)).toBe(true);
    expect(on('phone', tagline)).toBe(false);
    const calls = screen.getByRole('link', { name: /Calls/ });
    const visibleWord = within(calls)
      .getAllByText('Calls')
      .find((n) => n.className.includes('sm:inline'))!;
    const srOnly = within(calls)
      .getAllByText('Calls')
      .find((n) => n.className.includes('sr-only'))!;
    expect(on('laptop', visibleWord)).toBe(true);
    expect(on('phone', visibleWord)).toBe(false);
    expect(on('phone', srOnly)).toBe(true);
    expect(on('laptop', srOnly)).toBe(false);
  });
});

describe('chat header', () => {
  const conv = makeConversation();
  const group = makeConversation({
    type: 'group',
    title: 'Team',
    peer: null,
    member_count: 3,
    my_role: 'admin',
  });
  const renderHeader = (c = conv) =>
    render(
      <MemoryRouter>
        <ChatHeader conversation={c} />
      </MemoryRouter>,
    );

  it('phone: back, name, voice call and the ⋮ menu only', () => {
    renderHeader();
    expect(on('phone', byName('Back to chats'))).toBe(true);
    expect(on('phone', byName('Start voice call with Bob'))).toBe(true);
    expect(on('phone', byName('Chat options'))).toBe(true);
    expect(on('phone', byName('Start video call with Bob'))).toBe(false);
    expect(on('phone', byName('Ask Flick'))).toBe(false);
    expect(on('phone', byName('Close conversation'))).toBe(false);
  });

  it('laptop: every action inline, a close button, and no back arrow', () => {
    renderHeader();
    expect(on('laptop', byName('Start video call with Bob'))).toBe(true);
    expect(on('laptop', byName('Ask Flick'))).toBe(true);
    expect(on('laptop', byName('Close conversation'))).toBe(true);
    expect(on('laptop', byName('Back to chats'))).toBe(false);
  });

  it('phone targets are at least 44px (min-h-11 / min-w-11) for the controls that stay', () => {
    renderHeader();
    for (const name of ['Back to chats', 'Start voice call with Bob']) {
      expect(byName(name)).toHaveClass('min-h-11', 'min-w-11');
    }
    expect(byName('Chat options')).toHaveClass('max-sm:min-h-11', 'max-sm:min-w-11');
  });

  it('a group: group call and info are inline on laptops, in the menu on phones', () => {
    renderHeader(group);
    expect(on('laptop', byName('Start group call'))).toBe(true);
    expect(on('laptop', byName('Group info'))).toBe(true);
    expect(on('phone', byName('Start group call'))).toBe(false);
    expect(on('phone', byName('Group info'))).toBe(false);
  });
});

describe('composer', () => {
  const renderComposer = () =>
    render(<MessageInput conversation={makeConversation()} messages={[]} />);

  it('phone: one "+" menu, the text field, the mic and Send', () => {
    renderComposer();
    expect(on('phone', byName('More actions'))).toBe(true);
    expect(on('phone', byName('Record voice message'))).toBe(true);
    expect(on('phone', byName('Send message'))).toBe(true);
    for (const name of [
      'Insert emoji',
      'Attach photo or video',
      'Attach file',
      'GIFs and stickers',
      'Create poll',
    ]) {
      expect(on('phone', byName(name))).toBe(false);
    }
  });

  it('laptop: the inline buttons and no "+" menu', () => {
    renderComposer();
    expect(on('laptop', byName('More actions'))).toBe(false);
    for (const name of [
      'Insert emoji',
      'Attach photo or video',
      'Attach file',
      'GIFs and stickers',
      'Create poll',
      'Record voice message',
      'Send message',
    ]) {
      expect(on('laptop', byName(name))).toBe(true);
    }
  });

  it('the text field is 16px on phones so iOS does not zoom, and 44px tall', () => {
    renderComposer();
    expect(screen.getByRole('textbox', { name: /^Message / })).toHaveClass(
      'max-sm:text-base',
      'max-sm:min-h-11',
    );
  });

  it('on phones Send sits after the field (order-2) and the mic before it (order-1)', () => {
    renderComposer();
    expect(byName('Send message')).toHaveClass('max-sm:order-2');
    expect(byName('Record voice message')).toHaveClass('max-sm:order-1');
  });
});

describe('message action sheet', () => {
  const props = {
    onClose: vi.fn(),
    isMine: true,
    pinned: false,
    starred: false,
    canEdit: true,
    copyText: 'x',
    canTranslate: true,
    onReact: vi.fn(),
    onReply: vi.fn(),
    onCopy: vi.fn(),
    onEdit: vi.fn(),
    onTranslate: vi.fn(),
    onReport: vi.fn(),
    onDelete: vi.fn(),
  };

  it('is a bottom sheet on phones (items-end, full width, grabber) and a small card on laptops', () => {
    render(<MessageMenu {...props} />);
    const dialog = screen.getByRole('dialog', { name: 'Message actions' });
    const overlay = dialog.parentElement!;
    expect(overlay).toHaveClass('items-end', 'p-0', 'sm:items-center', 'sm:p-4');
    expect(dialog).toHaveClass('w-full', 'sm:w-80');
    const grabber = dialog.querySelector('.h-1.w-10')!;
    expect(on('phone', grabber)).toBe(true);
    expect(on('laptop', grabber)).toBe(false);
  });

  it('every action is at least 48px tall for thumbs', () => {
    render(<MessageMenu {...props} />);
    for (const item of screen.getAllByRole('menuitem')) expect(item).toHaveClass('min-h-12');
  });
});

describe('home page', () => {
  const renderHome = () =>
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );

  it('no chat open: the list fills a phone; the welcome pane is for laptops only', () => {
    useChatStore.setState({ listStatus: 'ready' });
    renderHome();
    expect(on('phone', screen.getByLabelText('Search chats'))).toBe(true);
    expect(on('laptop', screen.getByLabelText('Search chats'))).toBe(true);
    const welcome = screen.getByRole('heading', { name: 'Welcome to Flick' });
    expect(on('phone', welcome)).toBe(false);
    expect(on('laptop', welcome)).toBe(true);
  });

  it('a chat open: it fills a phone and the list is out of the way; laptops show both', () => {
    const conv = makeConversation();
    useChatStore.setState({
      conversations: { [conv.id]: conv },
      selectedId: conv.id,
      listStatus: 'ready',
      threads: {
        [conv.id]: {
          messages: [],
          status: 'ready',
          hasOlder: false,
          loadingOlder: false,
          error: null,
        },
      },
    });
    renderHome();
    const search = screen.getByLabelText('Search chats');
    const chat = screen.getByRole('region', { name: 'Chat with Bob' });
    expect(on('phone', search)).toBe(false);
    expect(on('phone', chat)).toBe(true);
    expect(on('laptop', search)).toBe(true);
    expect(on('laptop', chat)).toBe(true);
  });
});
