import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../../test/a11y';
import { installFakeServices } from '../../../test/fakes';
import { GUIDE_AREAS, TOPICS } from './catalog';
import { GuideSettings } from './GuideSettings';
import { disableGuideForTests, enableGuideForTests } from './testing';
import { markUsed, useGuideStore } from './useGuideStore';

const store = () => useGuideStore.getState();
const open = () =>
  render(
    <MemoryRouter>
      <GuideSettings />
    </MemoryRouter>,
  );

beforeEach(() => {
  installFakeServices();
  enableGuideForTests('u1');
});
afterEach(() => {
  disableGuideForTests();
});

describe('guide centre (Settings > Guide and tips)', () => {
  it('lists every topic under its area with a "Show me" button', () => {
    open();
    for (const label of Object.values(GUIDE_AREAS)) {
      expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('button', { name: /^Show me / })).toHaveLength(TOPICS.length);
  });

  it('shows whether each topic is new, seen or used', () => {
    useGuideStore.setState({
      seen: { 'composer.gif': '2026-01-01T10:00:00.000Z' },
      used: { 'composer.poll': '2026-01-01T10:00:00.000Z' },
    });
    open();
    const row = (title: string) => screen.getByText(title).closest('li') as HTMLElement;
    expect(within(row('GIFs and stickers')).getByText('Seen')).toBeInTheDocument();
    expect(within(row('Polls')).getByText('Used')).toBeInTheDocument();
    expect(within(row('Voice notes')).getByText('New')).toBeInTheDocument();
  });

  it('"Show me" plays that topic even if it was seen', async () => {
    const user = userEvent.setup();
    useGuideStore.setState({ seen: { 'composer.gif': '2026-01-01T10:00:00.000Z' } });
    open();
    await user.click(screen.getByRole('button', { name: 'Show me GIFs and stickers' }));
    await vi.waitFor(() => {
      expect(store().active).toMatchObject({ topicId: 'composer.gif', source: 'replay' });
    });
  });

  it('"Take the tour" starts the welcome tour', async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole('button', { name: 'Take the tour' }));
    await vi.waitFor(() => {
      expect(store().active).toMatchObject({ topicId: 'welcome', source: 'welcome' });
    });
  });

  it('the switch turns tips off and on', async () => {
    const user = userEvent.setup();
    open();
    const toggle = screen.getByRole('switch', { name: 'Show tips as I use new features' });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(store().enabled).toBe(false);
    await user.click(toggle);
    expect(store().enabled).toBe(true);
  });

  it('"Reset" forgets what was seen and used, so the tips can show again', async () => {
    const user = userEvent.setup();
    markUsed('composer.poll');
    useGuideStore.setState({ seen: { 'composer.gif': '2026-01-01T10:00:00.000Z' } });
    open();
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(store().seen).toEqual({});
    expect(store().used).toEqual({});
    expect(store().welcomeDoneAt).toBeNull();
    expect(store().pendingReset).toBe(true);
    store().requestTip('composer.poll');
    expect(store().queue).toEqual(['composer.poll']);
  });

  it('has no accessibility violations', async () => {
    const { container } = open();
    await expectNoA11yViolations(container);
  });
});
