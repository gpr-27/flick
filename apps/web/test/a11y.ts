import axe from 'axe-core';
import { expect } from 'vitest';

/**
 * Runs axe-core on rendered DOM and fails with a readable list of violations.
 *
 * jsdom has no layout engine, so the rules that need real geometry or painted colours cannot
 * give a true answer there and are switched off: `color-contrast` (needs painted colours),
 * `region` (a fragment rendered alone is not a whole page) and `scrollable-region-focusable`
 * (needs scroll sizes). Everything else (names, roles, labels, ARIA validity, duplicate ids,
 * list structure, ...) runs for real.
 */
export async function expectNoA11yViolations(
  container: Element = document.body,
  options: { disable?: string[] } = {},
): Promise<void> {
  const rules: Record<string, { enabled: boolean }> = {};
  const off = [
    'color-contrast',
    'region',
    'scrollable-region-focusable',
    ...(options.disable ?? []),
  ];
  for (const id of off) rules[id] = { enabled: false };
  const results = await axe.run(container, { rules });
  const report = results.violations
    .map(
      (v) =>
        `${v.id} (${v.impact ?? 'n/a'}): ${v.help}\n` +
        v.nodes.map((n) => `    ${n.target.join(' ')}\n    ${n.html.slice(0, 160)}`).join('\n'),
    )
    .join('\n');
  expect(results.violations, `Accessibility violations:\n${report}`).toEqual([]);
}
