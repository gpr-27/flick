import { test, expect } from '@playwright/test';
import { openChat, send, signIn, startDirectChat, uniqueName } from './support';

// Journey: a message with markdown shows up as rich text for the other person: a real table,
// a heading and a list, and never as live HTML. This needs the composer to accept a
// multi-line message (a textarea); `fill` keeps the new lines there.
test('a markdown table, heading and list render as real elements', async ({ browser }) => {
  const bob = await signIn(browser, uniqueName('bob'));
  const alice = await signIn(browser, uniqueName('alice'));

  await startDirectChat(alice.page, bob.name);
  await send(
    alice.page,
    [
      '## Shopping',
      '',
      '- apples',
      '- pears',
      '',
      '| Item | Qty | Price |',
      '|:-----|:---:|------:|',
      '| Apple | 3 | $1 |',
      '| Pear | 12 | $22 |',
      '',
      '<script>window.__pwned = true</script>',
    ].join('\n'),
  );

  await openChat(bob.page, alice.name);
  const message = bob.page.getByRole('article').filter({ hasText: 'Shopping' });

  await expect(message.getByRole('heading', { level: 2, name: 'Shopping' })).toBeVisible();
  await expect(message.getByRole('listitem')).toHaveText(['apples', 'pears']);

  const table = message.getByRole('table');
  await expect(table.getByRole('columnheader')).toHaveText(['Item', 'Qty', 'Price']);
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(table.getByRole('row').nth(2).getByRole('cell')).toHaveText(['Pear', '12', '$22']);

  // The script tag is only text.
  await expect(message).toContainText('<script>');
  expect(await bob.page.evaluate(() => (window as { __pwned?: boolean }).__pwned)).toBeUndefined();
});
