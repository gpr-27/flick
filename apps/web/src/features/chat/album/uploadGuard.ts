// Leaving a chat (or closing the tab) while album/photo uploads are still running cancels the
// uploads that were never sent. The composer reports how many are running; the chat switch and
// the browser's beforeunload ask the person first.

/** What the guard should do for this many uploads still in flight. */
export const leaveDecision = (cancellable: number): { confirm: boolean; message: string } => {
  if (cancellable <= 0) return { confirm: false, message: '' };
  return {
    confirm: true,
    message:
      cancellable === 1
        ? '1 upload is still in progress. Leave and cancel it?'
        : `${String(cancellable)} uploads are still in progress. Leave and cancel them?`,
  };
};

let cancellable = 0;
let running = 0;

/** Called by the composer: uploads that leaving would cancel, and all uploads still running. */
export const reportUploads = (counts: { cancellable: number; running: number }): void => {
  cancellable = counts.cancellable;
  running = counts.running;
};

/** True when it is fine to switch chat (nothing to lose, or the person agreed). */
export const confirmLeaveChat = (
  ask: (message: string) => boolean = window.confirm.bind(window),
): boolean => {
  const d = leaveDecision(cancellable);
  if (!d.confirm) return true;
  const ok = ask(d.message);
  if (ok) cancellable = 0;
  return ok;
};

/** beforeunload handler: asks the browser to warn while any upload is running. */
export const onBeforeUnload = (e: BeforeUnloadEvent): void => {
  if (running <= 0) return;
  e.preventDefault();
};
