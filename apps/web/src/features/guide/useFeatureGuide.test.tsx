import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeServices } from '../../../test/fakes';
import { disableGuideForTests, enableGuideForTests } from './testing';
import { useFeatureGuide, useFeatureGuides, useMarkUsedWhen } from './useFeatureGuide';
import { markUsed, useGuideStore } from './useGuideStore';

const store = () => useGuideStore.getState();

const Screen = ({ ready = true, used = false }: { ready?: boolean; used?: boolean }) => {
  useFeatureGuide('composer.gif', ready);
  useFeatureGuides(['composer.poll', 'composer.emoji']);
  useMarkUsedWhen('composer.voice', used);
  return null;
};

beforeEach(() => {
  installFakeServices();
  enableGuideForTests('u1');
});
afterEach(() => {
  disableGuideForTests();
});

describe('useFeatureGuide', () => {
  it('queues the tips when the screen shows, in order, and drops them when it goes away', () => {
    const { unmount } = render(<Screen />);
    expect(store().queue).toEqual(['composer.gif', 'composer.poll', 'composer.emoji']);
    unmount();
    expect(store().queue).toEqual([]);
  });

  it('waits until the thing it points at is on screen', () => {
    const { rerender } = render(<Screen ready={false} />);
    expect(store().queue).toEqual(['composer.poll', 'composer.emoji']);
    rerender(<Screen ready />);
    expect(store().queue).toContain('composer.gif');
  });

  it('does not queue a feature that was used before', () => {
    markUsed('composer.gif');
    render(<Screen />);
    expect(store().queue).not.toContain('composer.gif');
  });

  it('marks a feature used the moment it is used', () => {
    const { rerender } = render(<Screen />);
    expect(store().used).not.toHaveProperty('composer.voice');
    rerender(<Screen used />);
    expect(store().used).toHaveProperty('composer.voice');
  });
});
