import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENDPOINTS, type UserSummary } from '@chat/contracts';
import { useSessionStore } from '@/features/auth/useSessionStore';
import { ME, installFakeServices, type FakeApi } from '../../../test/fakes';
import { PeopleDirectory, type PeopleDirectoryProps } from './PeopleDirectory';

// jsdom does no layout: give every element a size so the virtual list has a viewport.
const saved: [string, PropertyDescriptor | undefined][] = [];
beforeAll(() => {
  for (const [key, value] of [
    ['clientHeight', 400],
    ['clientWidth', 320],
  ] as const) {
    saved.push([key, Object.getOwnPropertyDescriptor(Element.prototype, key)]);
    Object.defineProperty(Element.prototype, key, { configurable: true, value });
  }
});
afterAll(() => {
  for (const [key, desc] of saved) {
    if (desc) Object.defineProperty(Element.prototype, key, desc);
  }
});

const person = (display_name: string, id = display_name.toLowerCase()): UserSummary => ({
  id,
  username: id.replace(/\s/g, '_'),
  display_name,
  avatar_url: null,
  is_bot: false,
});

type Page = { items: UserSummary[]; next_cursor: string | null };

/** Answers directory and search calls from the given data. */
const serve = (
  api: FakeApi,
  directory: (cursor: string | undefined) => Page | Promise<Page>,
  search: (q: string) => UserSummary[] = () => [],
): void => {
  api.call.mockImplementation((endpoint: unknown, options: unknown) => {
    const query = (options as { query: { cursor?: string; q?: string } }).query;
    if (endpoint === ENDPOINTS.users.directory) return Promise.resolve(directory(query.cursor));
    if (endpoint === ENDPOINTS.users.search) {
      return Promise.resolve({ items: search(query.q ?? ''), next_cursor: null });
    }
    return Promise.reject(new Error('unexpected call'));
  });
};

const directoryCalls = (api: FakeApi): unknown[] =>
  api.call.mock.calls
    .filter(([e]) => e === ENDPOINTS.users.directory)
    .map(([, o]) => (o as { query: unknown }).query);

let api: FakeApi;
beforeEach(() => {
  api = installFakeServices().api;
  useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
});

const setup = (props: Partial<PeopleDirectoryProps> = {}) => {
  const onPick = vi.fn();
  render(
    <PeopleDirectory
      onPick={onPick}
      actionLabel={(u) => `Chat with ${u.display_name}`}
      {...props}
    />,
  );
  return onPick;
};

describe('PeopleDirectory', () => {
  it('lists everyone A to Z under letter headers, with a count', async () => {
    serve(api, () => ({
      items: [person('amy'), person('Bob'), person('Émile'), person('😀 Joy')],
      next_cursor: null,
    }));
    setup();

    expect(await screen.findByText('4 people on Flick')).toBeInTheDocument();
    const headers = [...document.querySelectorAll('[data-letter-header]')].map(
      (h) => h.textContent,
    );
    expect(headers).toEqual(['A', 'B', 'E', '#']);
    const options = screen.getAllByRole('option');
    expect(options.map((o) => within(o).getByText(/^@/).textContent)).toEqual([
      '@amy',
      '@bob',
      '@émile',
      '@😀_joy',
    ]);
    expect(screen.getByRole('button', { name: 'Chat with Bob' })).toHaveTextContent('Message');
    expect(screen.getByRole('button', { name: 'Invite friends' })).toBeInTheDocument();
  });

  it('picks a person with the Message button', async () => {
    serve(api, () => ({ items: [person('Bob')], next_cursor: null }));
    const onPick = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Chat with Bob' }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'bob' }));
  });

  it('never lists me', async () => {
    serve(api, () => ({ items: [person('Me', ME), person('Bob')], next_cursor: null }));
    setup();
    await screen.findByText('1 person on Flick');
    expect(screen.queryByRole('button', { name: 'Chat with Me' })).toBeNull();
  });

  it('loads the next page with Load more and appends it, asking for each page once', async () => {
    serve(api, (cursor) =>
      cursor === 'c1'
        ? { items: [person('Zed')], next_cursor: null }
        : { items: [person('Amy')], next_cursor: 'c1' },
    );
    setup();
    expect(await screen.findByText('1+ people on Flick')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('2 people on Flick')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chat with Zed' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chat with Amy' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    expect(directoryCalls(api)).toEqual([
      { cursor: undefined, limit: 50 },
      { cursor: 'c1', limit: 50 },
    ]);
  });

  it('loads the next page by itself when the end of the list comes into view', async () => {
    let seen: IntersectionObserverCallback = () => undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          seen = callback;
        }
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
    try {
      serve(api, (cursor) =>
        cursor === 'c1'
          ? { items: [person('Zed')], next_cursor: null }
          : { items: [person('Amy')], next_cursor: 'c1' },
      );
      setup();
      await screen.findByText('1+ people on Flick');
      seen([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      expect(await screen.findByText('2 people on Flick')).toBeInTheDocument();
      expect(directoryCalls(api)).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('searches when text is typed and shows the directory again when it is cleared', async () => {
    serve(
      api,
      () => ({ items: [person('Amy'), person('Zoe')], next_cursor: null }),
      (q) => [person('Zoe')].filter((u) => u.display_name.toLowerCase().includes(q)),
    );
    setup();
    await screen.findByText('2 people on Flick');

    await userEvent.type(screen.getByLabelText('Search people'), 'zo');
    expect(await screen.findByText('1 result')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Chat with Amy' })).toBeNull();
    expect(document.querySelector('[data-letter-header]')).toBeNull();
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.users.search, { query: { q: 'zo' } });

    await userEvent.clear(screen.getByLabelText('Search people'));
    expect(await screen.findByText('2 people on Flick')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chat with Amy' })).toBeInTheDocument();
  });

  it('says so when a search finds no one', async () => {
    serve(api, () => ({ items: [person('Amy')], next_cursor: null }));
    setup();
    await screen.findByText('1 person on Flick');
    await userEvent.type(screen.getByLabelText('Search people'), 'qq');
    expect(await screen.findByText('No one found')).toBeInTheDocument();
  });

  it('shows people already in the group as disabled, with a label and no button', async () => {
    serve(api, () => ({ items: [person('Amy'), person('Bob')], next_cursor: null }));
    setup({ disabledIds: ['amy'], disabledLabel: 'In this group', buttonText: 'Add' });
    await screen.findByText('2 people on Flick');
    const amy = screen.getByRole('option', { name: /Amy/ });
    expect(amy).toHaveAttribute('aria-disabled', 'true');
    expect(within(amy).getByText('In this group')).toBeInTheDocument();
    expect(within(amy).queryByRole('button')).toBeNull();
    expect(screen.getByRole('button', { name: 'Chat with Bob' })).toHaveTextContent('Add');
  });

  it('shows skeleton rows while the first page loads', () => {
    api.call.mockImplementation(() => new Promise(() => undefined));
    setup();
    expect(screen.getByRole('status', { name: 'Loading people' })).toBeInTheDocument();
  });

  it('shows an empty state with an invite button when no one else is here', async () => {
    serve(api, () => ({ items: [], next_cursor: null }));
    setup();
    expect(await screen.findByText('No one else is here yet')).toBeInTheDocument();
    expect(screen.getByText('Invite a friend')).toBeInTheDocument();
  });

  it('shows an error with Retry, and Retry loads the list', async () => {
    serve(api, () => ({ items: [person('Amy')], next_cursor: null }));
    // The first call fails, the second (Retry) succeeds.
    api.call.mockRejectedValueOnce(new Error('offline'));
    setup();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('1 person on Flick')).toBeInTheDocument();
  });

  it('moves with the arrow keys and opens the chat with Enter', async () => {
    serve(api, () => ({
      items: [person('Amy'), person('Bob'), person('Cy')],
      next_cursor: null,
    }));
    const onPick = setup({ disabledIds: ['bob'] });
    await screen.findByText('3 people on Flick');
    const search = screen.getByLabelText('Search people');
    await userEvent.click(search);

    await userEvent.keyboard('{Enter}');
    expect(onPick).not.toHaveBeenCalled(); // nothing highlighted yet

    await userEvent.keyboard('{ArrowDown}');
    expect(search).toHaveAttribute('aria-activedescendant', 'person-amy');
    expect(screen.getByRole('option', { name: /Amy/ })).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{ArrowDown}'); // skips Bob, who is disabled
    expect(search).toHaveAttribute('aria-activedescendant', 'person-cy');
    await userEvent.keyboard('{ArrowDown}'); // stays on the last one
    expect(search).toHaveAttribute('aria-activedescendant', 'person-cy');
    await userEvent.keyboard('{ArrowUp}');
    expect(search).toHaveAttribute('aria-activedescendant', 'person-amy');

    await userEvent.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledOnce();
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'amy' }));
  });

  it('has a letter jump bar for phones', async () => {
    serve(api, () => ({ items: [person('Amy'), person('Bob')], next_cursor: null }));
    setup();
    await screen.findByText('2 people on Flick');
    const bar = screen.getByRole('group', { name: 'Jump to letter' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Jump to B' }));
    expect(
      within(bar)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['A', 'B']);
  });

  it('keeps the page small with 5,000 people: only the rows on screen are in the DOM', async () => {
    const everyone = Array.from({ length: 5000 }, (_, i) =>
      person(`Person ${String(i).padStart(4, '0')}`, `id-${i}`),
    );
    serve(api, () => ({ items: everyone, next_cursor: null }));
    setup();
    expect(await screen.findByText('5000 people on Flick')).toBeInTheDocument();
    const rendered = screen.getAllByRole('option').length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(40);
    await waitFor(() => {
      expect(
        document.querySelectorAll('[role="option"], [data-letter-header]').length,
      ).toBeLessThan(50);
    });
  });
});
