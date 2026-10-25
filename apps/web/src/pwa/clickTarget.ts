// Which open Flick window a tapped notification should use. Pure, so it is unit-tested.

export interface WindowInfo {
  focused: boolean;
  visibilityState: string;
}

/**
 * The window to bring forward: the one the person is looking at, else one that is visible, else
 * any. Returns undefined when no Flick window is open (the caller then opens a new one).
 */
export function pickWindow<T extends WindowInfo>(windows: T[]): T | undefined {
  return (
    windows.find((w) => w.focused) ??
    windows.find((w) => w.visibilityState === 'visible') ??
    windows[0]
  );
}
