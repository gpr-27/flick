# ADR-0024: Phone Back navigation and gestures

- **Status:** Accepted (2026-10-27)
- **Related:** ADR-0022

## Context

On a phone, the Back button or the back swipe is the main way to close things. A single-page app that ignores it throws
the person out of the chat when they only wanted to close a picture viewer or a menu. Each overlay (modal, sheet,
popover, viewer) had its own close logic and none of it knew about browser history.

## Decision

One small module decides what Back does (`apps/web/src/lib/backStack.ts`, with React glue in `useBackClose.ts`).

- **Back stack with `pushState`.** Every open overlay pushes exactly one history entry, marked in `history.state`. A
  `popstate` while overlays are open closes the topmost one. When an overlay is closed another way (X, Esc, tap outside,
  code), its entry is removed again with `history.back()`, only if it is still the current entry.
- **Overlay wiring.** An overlay opts in with `useBackClose(open, onClose)`. 18 files use it today (viewer, sheets,
  dialogs, menus and others). If the owner refuses to close (a confirm step), the entry is put back so Back keeps working.
  The call overlays and the guide tour are not wired yet.
- **Edge swipe.** A touch that starts within 24 px of the left edge and moves right (past 33 percent of the width, or a
  quick flick) goes back, with the page following the finger (`navGestureMath.ts`, `EdgeSwipeBack.tsx`). Swiping down
  closes a sheet. Inputs, sliders, canvases and sideways scrollers keep their own touch behaviour.
- **Double Back to exit.** In the installed app at the root page, a sentinel history entry is placed under the app. The
  first Back shows "Press back again to exit"; a second Back within 2 seconds leaves. The sentinel returns afterwards.
- **iOS Safari exception.** On iOS in a browser tab, Safari has its own edge swipe for Back, and a second one would
  fight it, so ours is skipped (`shouldSkipEdgeSwipe`). In the installed iOS app there is no system swipe, so ours is used.
- **No history entry for the first page.** `goBack` uses real history when there is a step before this page, and goes to
  the chat list when the page was opened directly.

## Alternatives

- **Each overlay handles `popstate` itself.** Several handlers fight each other and entries get out of order.
- **Ignore Back.** Simple, but it feels broken on a phone.
- **Always add our own edge swipe.** Double gestures on iOS Safari.

## Trade-offs

Every open overlay adds a history entry, so a fast open and close must remove it cleanly; the module is tested against a
fake history for that reason. Browsers do not let an app truly intercept "leave the app", so the double-Back guard works
only in the installed app. The overlays in the exceptions list above still close the old way.

## Consequences

- New overlays call one hook to get Back support.
- Tests: `backStack.test.ts`, `navGestureMath.test.ts`.
- Docs: [`../features/message-gestures.md`](../features/message-gestures.md).
