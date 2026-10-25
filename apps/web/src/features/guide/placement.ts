// Where the explanation card goes. Pure maths, so it can be tested without a browser.
//   - no target (or it is hidden / off screen): the card is centred;
//   - phone: the card is docked to the bottom edge (above the safe area), or to the top edge when
//     the bottom would cover the highlighted element;
//   - otherwise: next to the element, above or below it as asked, and kept inside the window.
import type { GuidePlacement } from './catalog';
import type { Box } from './targets';

export interface PlacementInput {
  viewport: { width: number; height: number };
  target: Box | null;
  card: { width: number; height: number };
  placement?: GuidePlacement | undefined;
  phone: boolean;
  safe: { top: number; bottom: number };
}

export type Placement =
  | { mode: 'centered' }
  | { mode: 'docked'; edge: 'top' | 'bottom' }
  | { mode: 'anchored'; top: number; left: number };

const GAP = 14;
const EDGE = 12;
/** Breathing room drawn around the highlighted element. */
export const SPOT_PADDING = 6;

const overlaps = (a: Box, top: number, height: number): boolean =>
  a.top - SPOT_PADDING < top + height && a.top + a.height + SPOT_PADDING > top;

export function placeCard(input: PlacementInput): Placement {
  const { viewport, target, card, phone, safe } = input;
  if (!target) return { mode: 'centered' };

  if (phone) {
    const bottomTop = viewport.height - safe.bottom - EDGE - card.height;
    const topTop = safe.top + EDGE;
    if (!overlaps(target, bottomTop, card.height)) return { mode: 'docked', edge: 'bottom' };
    if (!overlaps(target, topTop, card.height)) return { mode: 'docked', edge: 'top' };
    // The element is too big for either edge: keep the card at the edge with more of the element free.
    const targetMiddle = target.top + target.height / 2;
    return { mode: 'docked', edge: targetMiddle > viewport.height / 2 ? 'top' : 'bottom' };
  }

  const roomBelow = viewport.height - (target.top + target.height + SPOT_PADDING) - GAP - EDGE;
  const roomAbove = target.top - SPOT_PADDING - GAP - EDGE;
  const wantTop = input.placement === 'top';
  const wantBottom = input.placement === 'bottom';
  const fitsBelow = roomBelow >= card.height;
  const fitsAbove = roomAbove >= card.height;
  let below: boolean;
  if (wantBottom && fitsBelow) below = true;
  else if (wantTop && fitsAbove) below = false;
  else if (fitsBelow || fitsAbove) below = fitsBelow && (!fitsAbove || roomBelow >= roomAbove);
  else return { mode: 'centered' };

  const top = below
    ? target.top + target.height + SPOT_PADDING + GAP
    : target.top - SPOT_PADDING - GAP - card.height;
  const centre = target.left + target.width / 2;
  const left = Math.min(
    Math.max(EDGE, centre - card.width / 2),
    Math.max(EDGE, viewport.width - card.width - EDGE),
  );
  return { mode: 'anchored', top, left };
}
