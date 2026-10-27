// Turning what the person picked, pasted or dropped into a list of files, and deciding where
// that list goes: one file keeps the single-file flow (with the photo editor), two or more (or any
// file added to a tray that is already open) go to the media tray.

/** Every photo or video on the clipboard (copied files, screenshots). */
export const mediaFilesFromClipboard = (data: DataTransfer | null): File[] =>
  [...(data?.files ?? [])].filter((f) => /^(image|video)\//.test(f.type));

export type PickRoute = 'single' | 'tray' | 'none';

/** Where a pick goes. `trayOpen` is true while the media tray holds items. */
export const routePick = (fileCount: number, trayOpen: boolean): PickRoute => {
  if (fileCount === 0) return 'none';
  if (trayOpen || fileCount >= 2) return 'tray';
  return 'single';
};
