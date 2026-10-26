import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { featureLabel, usagePercent } from './aiControls';
import { WhyFlickSaid } from './WhyFlickSaid';
import { sourceLines } from './whySources';

describe('ai controls', () => {
  it('computes usage percent', () => {
    expect(usagePercent(50, 200)).toBe(25);
    expect(usagePercent(500, 200)).toBe(100);
    expect(usagePercent(1, 0)).toBe(0);
  });
  it('labels features', () => {
    expect(featureLabel('suggest-replies')).toBe('Reply suggestions');
    expect(featureLabel('some_new-one')).toBe('some new one');
  });
  it('lists sources', () => {
    expect(sourceLines({ messages: 1, files: 2, app_knowledge: true })).toEqual([
      '1 recent message from this chat',
      '2 files you sent',
      'Flick’s knowledge of the app and your settings',
    ]);
  });
  it('opens the popover', async () => {
    render(<WhyFlickSaid sources={{ messages: 5, files: 0, app_knowledge: false }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Why did Flick say this?' }));
    expect(screen.getByText('5 recent messages from this chat')).toBeInTheDocument();
  });
});
