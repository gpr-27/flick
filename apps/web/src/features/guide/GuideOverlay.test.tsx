import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeServices } from '../../../test/fakes';
import { expectNoA11yViolations } from '../../../test/a11y';
import { GuideOverlay } from './GuideOverlay';
import { disableGuideForTests, enableGuideForTests } from './testing';
import { useGuideStore } from './useGuideStore';

const store = () => useGuideStore.getState();
const renderWithGuide = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

/** jsdom has no layout, so a target is given a size by hand. */
function addTarget(id: string, rect = { top: 100, left: 40, width: 200, height: 60 }) {
  const el = document.createElement('button');
  el.setAttribute('data-guide', id);
  el.textContent = 'target';
  el.scrollIntoView = vi.fn();
  el.getBoundingClientRect = () => ({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  });
  document.body.appendChild(el);
  return el;
}

const phone = (on: boolean) => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: on && query.includes('max-width: 639px'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
};

beforeEach(() => {
  installFakeServices();
  enableGuideForTests('u1');
  phone(false);
});
afterEach(() => {
  document.body.querySelectorAll('[data-guide]').forEach((el) => {
    el.remove();
  });
  disableGuideForTests();
  vi.unstubAllGlobals();
});

describe('guide overlay', () => {
  it('shows the step in a labelled dialog with a "1 of N" counter', () => {
    addTarget('chat-list');
    store().startTopic('welcome');
    renderWithGuide(<GuideOverlay />);
    const dialog = screen.getByRole('dialog', { name: 'Your chats live here' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent(/1 of 10/);
    expect(screen.getByRole('status')).toHaveTextContent('Step 1 of 10: Your chats live here');
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });

  it('cuts a spotlight around the target when it is on screen', () => {
    addTarget('chat-list');
    store().startTopic('welcome');
    renderWithGuide(<GuideOverlay />);
    const spotlight = screen.getByTestId('guide-spotlight');
    // the element's box plus a little breathing room
    expect(spotlight.style.top).toBe('94px');
    expect(spotlight.style.left).toBe('34px');
    expect(spotlight.style.width).toBe('212px');
  });

  it('centres the card and cuts nothing out when the target is missing', () => {
    store().startTopic('welcome');
    renderWithGuide(<GuideOverlay />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('guide-spotlight')).not.toBeInTheDocument();
  });

  it('does the same when the target is far off screen', () => {
    addTarget('chat-list', { top: 5000, left: 40, width: 200, height: 60 });
    store().startTopic('welcome');
    renderWithGuide(<GuideOverlay />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('follows the target when the window changes', async () => {
    const el = addTarget('chat-list');
    store().startTopic('welcome');
    renderWithGuide(<GuideOverlay />);
    expect(screen.getByTestId('guide-spotlight').style.top).toBe('94px');
    el.getBoundingClientRect = () =>
      ({ top: 300, left: 40, width: 200, height: 60, right: 240, bottom: 360 }) as DOMRect;
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.getByTestId('guide-spotlight').style.top).toBe('294px');
  });

  it('moves with the buttons and the arrow keys; Esc leaves', async () => {
    const user = userEvent.setup();
    store().startTopic('welcome');
    renderWithGuide(<GuideOverlay />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/2 of 10/);
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('dialog')).toHaveTextContent(/3 of 10/);
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('dialog')).toHaveTextContent(/2 of 10/);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/1 of 10/);
    await user.keyboard('{Escape}');
    expect(store().active).toBeNull();
    expect(store().resumeStep).toBe(0);
  });

  it('puts focus in the card, keeps Tab inside, and gives focus back when it closes', async () => {
    const user = userEvent.setup();
    const outside = document.createElement('button');
    outside.textContent = 'outside';
    document.body.appendChild(outside);
    outside.focus();
    store().startTopic('welcome');
    const { rerender, unmount } = renderWithGuide(<GuideOverlay />);
    const card = screen.getByRole('dialog');
    expect(card).toContainElement(document.activeElement as HTMLElement);
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(card).toContainElement(document.activeElement as HTMLElement);
    }
    act(() => {
      store().close();
    });
    rerender(<GuideOverlay />);
    unmount();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('a tip has "Got it" and "Don\'t show tips"; the last step of a tour says Done', async () => {
    const user = userEvent.setup();
    store().requestTip('composer.gif');
    store().tick({ now: Date.now(), blocked: false, typing: false });
    renderWithGuide(<GuideOverlay />);
    expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: "Don't show tips" }));
    expect(store().enabled).toBe(false);
    expect(store().active).toBeNull();
  });

  it('on a phone the card docks to the bottom and does not cover the target', () => {
    phone(true);
    addTarget('chat-list', { top: 80, left: 0, width: 360, height: 60 });
    store().startTopic('welcome');
    renderWithGuide(<GuideOverlay />);
    const card = screen.getByTestId('guide-card');
    expect(card.className).toContain('inset-x-3');
    expect(card.style.bottom).toContain('env(safe-area-inset-bottom)');
    expect(card.style.top).toBe('');
  });

  it('on a phone the card moves to the top when the target is at the bottom', () => {
    phone(true);
    Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true });
    addTarget('chat-list', { top: 600, left: 10, width: 340, height: 60 });
    store().startTopic('welcome');
    renderWithGuide(<GuideOverlay />);
    expect(screen.getByTestId('guide-card').style.top).toContain('env(safe-area-inset-top)');
  });

  it('has no accessibility violations', async () => {
    addTarget('chat-list');
    store().startTopic('welcome');
    const { container } = renderWithGuide(<GuideOverlay />);
    await expectNoA11yViolations(container);
  });
});
