// Which grid an album is drawn in. Pure, so the choice is tested and the list can reserve the
// grid's height (aspect ratio) before a single image has loaded.

export interface GridCell {
  /** 0-based column and row, and how many of each the tile covers. */
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

export interface AlbumGridLayout {
  /** Width divided by height of the whole grid. */
  aspect: number;
  /** CSS grid-template-columns / rows (fr units). */
  columns: string;
  rows: string;
  /** One cell per visible tile, in album order. */
  cells: GridCell[];
  /** On the last visible tile: "+N" for the items that are not drawn (0 = none hidden). */
  hidden: number;
}

const MAX_VISIBLE = 4;
/** A single photo is drawn between portrait 3:4 and landscape 3:2. */
const clampAspect = (aspect: number): number => Math.min(1.5, Math.max(0.75, aspect));

/**
 * 1: single tile in its own proportions. 2: two columns. 3: one large tile on top and two below.
 * 4: 2x2. 5 or more: 2x2 whose last tile says how many more there are.
 * `firstAspect` is width/height of the first item (only used for a single tile).
 */
export const albumLayout = (count: number, firstAspect = 1): AlbumGridLayout => {
  const n = Math.max(1, Math.floor(count));
  if (n === 1) {
    return {
      aspect: clampAspect(firstAspect),
      columns: '1fr',
      rows: '1fr',
      cells: [{ col: 0, row: 0, colSpan: 1, rowSpan: 1 }],
      hidden: 0,
    };
  }
  if (n === 2) {
    return {
      aspect: 2,
      columns: '1fr 1fr',
      rows: '1fr',
      cells: [
        { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
        { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
      ],
      hidden: 0,
    };
  }
  if (n === 3) {
    return {
      aspect: 1,
      columns: '1fr 1fr',
      rows: '2fr 1fr',
      cells: [
        { col: 0, row: 0, colSpan: 2, rowSpan: 1 },
        { col: 0, row: 1, colSpan: 1, rowSpan: 1 },
        { col: 1, row: 1, colSpan: 1, rowSpan: 1 },
      ],
      hidden: 0,
    };
  }
  return {
    aspect: 1,
    columns: '1fr 1fr',
    rows: '1fr 1fr',
    cells: [
      { col: 0, row: 0, colSpan: 1, rowSpan: 1 },
      { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
      { col: 0, row: 1, colSpan: 1, rowSpan: 1 },
      { col: 1, row: 1, colSpan: 1, rowSpan: 1 },
    ],
    // The last visible tile stands for itself and everything after it.
    hidden: n > MAX_VISIBLE ? n - (MAX_VISIBLE - 1) : 0,
  };
};

/** Pixel width the grid is drawn at (18rem), for the list's height estimate. */
export const ALBUM_WIDTH_PX = 288;

/** Estimated height of the grid in px, for the virtual list before it is measured. */
export const albumHeightPx = (count: number, firstAspect = 1): number =>
  Math.round(ALBUM_WIDTH_PX / albumLayout(count, firstAspect).aspect);
