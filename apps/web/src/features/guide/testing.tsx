// Helpers for tests that want the guide ON (it is off in every other test).
import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { forceGuideAvailable } from './guideEnv';
import { GUIDE_KEY, stopGuideSyncForTests, useGuideStore } from './useGuideStore';
import { EMPTY_STORED } from './progress';

/** Turn the guide on and start from a clean store (call in beforeEach). */
export function enableGuideForTests(userId: string | null = 'u1'): void {
  forceGuideAvailable(true);
  resetGuideStore(userId);
}

/** Back to the normal "off in tests" rule (call in afterEach). */
export function disableGuideForTests(): void {
  stopGuideSyncForTests();
  forceGuideAvailable(null);
  resetGuideStore(null);
}

/** Empty the guide's memory, the queue and this device's saved copy. */
export function resetGuideStore(userId: string | null = null): void {
  stopGuideSyncForTests();
  try {
    localStorage.removeItem(GUIDE_KEY);
  } catch {
    // no storage in this test environment
  }
  useGuideStore.setState({
    ...EMPTY_STORED,
    userId,
    settled: true,
    active: null,
    queue: [],
    lastTipAt: 0,
    holdTips: false,
  });
}

/** Render with the guide switched on and a router around it. */
export function renderWithGuide(ui: ReactElement, route = '/'): RenderResult {
  enableGuideForTests();
  return render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);
}
