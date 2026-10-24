// Negative controls for the accessibility helper: if axe silently stopped finding problems,
// every "no violations" test in the suite would pass for the wrong reason.
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoA11yViolations } from './a11y';

describe('expectNoA11yViolations', () => {
  it('passes a well-formed control', async () => {
    const { container } = render(<button type="button">Save</button>);
    await expectNoA11yViolations(container);
  });

  it('fails a button with no name', async () => {
    const { container } = render(<button type="button" />);
    await expect(expectNoA11yViolations(container)).rejects.toThrow(/button-name/);
  });

  it('fails an image with no alt text', async () => {
    const { container } = render(<img src="/x.png" />);
    await expect(expectNoA11yViolations(container)).rejects.toThrow(/image-alt/);
  });

  it('fails an input with no label', async () => {
    const { container } = render(<input type="text" />);
    await expect(expectNoA11yViolations(container)).rejects.toThrow(/label/);
  });

  it('fails duplicate ids and a bad ARIA role', async () => {
    const { container } = render(
      <div>
        <span id="a" role="nonsense" />
        <span id="a" />
      </div>,
    );
    await expect(expectNoA11yViolations(container)).rejects.toThrow(/duplicate-id|aria-roles/);
  });

  it('a rule can be switched off on purpose', async () => {
    const { container } = render(<img src="/x.png" />);
    await expectNoA11yViolations(container, { disable: ['image-alt'] });
  });
});
