// Pure viewport-collision maths for popovers, so every menu flips, shifts and scrolls the same way.

export interface Box {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export interface PlacementInput {
  /** The trigger's rectangle in viewport coordinates. */
  anchor: Box;
  /** The panel's natural size (its content, before any max-height is applied). */
  panel: { width: number; height: number };
  viewport: { width: number; height: number };
  /** Open below (`down`) or above (`up`) when both fit. */
  prefer?: 'down' | 'up';
  /** `right` lines the panel's right edge up with the anchor's; `left` its left edge. */
  align?: 'left' | 'right';
  /** Smallest distance kept to the viewport edge. */
  margin?: number;
  /** Distance between anchor and panel. */
  gap?: number;
}

export interface Placement {
  top: number;
  left: number;
  /** The panel must not be taller than this; it scrolls inside. */
  maxHeight: number;
  maxWidth: number;
  side: 'down' | 'up';
}

/**
 * Where to draw a panel next to an anchor: on the preferred side when it fits, otherwise on the
 * side with more room (flip); pushed back inside the viewport horizontally (shift); and limited in
 * height to the room that side has (the panel scrolls instead of being cut off).
 */
export const computePlacement = ({
  anchor,
  panel,
  viewport,
  prefer = 'down',
  align = 'right',
  margin = 8,
  gap = 4,
}: PlacementInput): Placement => {
  const below = Math.max(0, viewport.height - anchor.bottom - gap - margin);
  const above = Math.max(0, anchor.top - gap - margin);
  const fits = (room: number): boolean => panel.height <= room;
  let side: 'down' | 'up' = prefer;
  if (prefer === 'down' && !fits(below) && above > below) side = 'up';
  else if (prefer === 'up' && !fits(above) && below > above) side = 'down';

  const room = side === 'down' ? below : above;
  const height = Math.min(panel.height, room);
  const top = side === 'down' ? anchor.bottom + gap : anchor.top - gap - height;

  const maxWidth = Math.max(0, viewport.width - margin * 2);
  const width = Math.min(panel.width, maxWidth);
  const wanted = align === 'right' ? anchor.right - width : anchor.left;
  const left = Math.min(
    Math.max(wanted, margin),
    Math.max(margin, viewport.width - margin - width),
  );

  return { top, left, maxHeight: room, maxWidth, side };
};
