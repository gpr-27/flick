# Flick design system (as implemented)

This page describes the design system that is actually in the code today: colour and shape tokens, the two themes, fonts
(serif by default), measured contrast ratios, message bubble and link colours, the shared components, the phone tab bar,
the rule that hover styles only apply with a pointer, and how menus are portaled with collision handling. The tokens live
in `apps/web/src/index.css` and `apps/web/tailwind.config.ts`; the appearance settings that change them are applied by
`apps/web/src/features/settings/appearance.ts`. The reasoning behind the redesign is in
[`ui-redesign-spec.md`](ui-redesign-spec.md) and [ADR-0022](../decisions/0022-ui-redesign-and-serif-default.md).

Related: [`ui-redesign-spec.md`](ui-redesign-spec.md), [`../decisions/0022-ui-redesign-and-serif-default.md`](../decisions/0022-ui-redesign-and-serif-default.md),
[`../features/appearance-and-accessibility.md`](../features/appearance-and-accessibility.md), [`../../apps/web/README.md`](../../apps/web/README.md).

## Principles

1. **Solid surfaces carry content.** No frosted glass behind text. Blur only on the sticky top bar and modal scrims.
2. **Colour is for three things:** the primary action, your own messages and the brand mark. Everything else is neutral
   with a faint lavender tint.
3. **Tokens, not hex values,** in components. A theme is a set of CSS variables.
4. **Readable first:** text and bubble colours are checked against WCAG AA (4.5:1) by `theme-contrast.test.ts`.
5. **Works with a thumb:** 44 px touch targets, safe-area padding, a bottom tab bar on phones.

## Themes

| Theme | Attribute                                  | daisyUI name   | Use                                                  |
| ----- | ------------------------------------------ | -------------- | ---------------------------------------------------- |
| Light | `data-theme='pastel-glass'` (also `:root`) | `pastel-glass` | Default when the OS is light                         |
| Dark  | `data-theme='pastel-night'`                | `pastel-night` | Default when the OS is dark; "System" follows the OS |

The names are historical (the first design was glass); the surfaces are solid. Settings can force light or dark.

## Colour tokens

| Token                         | Light                        | Dark                             | Used for                          |
| ----------------------------- | ---------------------------- | -------------------------------- | --------------------------------- |
| `--bg-canvas` / `--page-bg`   | `#f5f4fa`                    | `#121019`                        | App background                    |
| `--bg-surface`                | `#ffffff`                    | `#1a1726`                        | Cards, lists, sheets              |
| `--bg-raised`                 | `#ffffff`                    | `#242036`                        | Popovers, toasts                  |
| `--bg-sunken`                 | `#eceaf4`                    | `#0d0b14`                        | Inputs, chips                     |
| `--bg-hover`                  | 5% ink                       | 6% white                         | Hover (pointer devices only)      |
| `--bg-active`                 | `#eeebfd`                    | `#2b2548`                        | Selected row                      |
| `--border`, `--border-strong` | `#e3e0ee`, `#cfcae0`         | 8%, 16% white                    | Dividers                          |
| `--text-1`                    | `#1d1a2f`                    | `#ece9f7`                        | Primary text                      |
| `--text-2`                    | `#5a5573`                    | `#a8a3c0`                        | Secondary text                    |
| `--text-3`, `--text-meta`     | `#6b6686` / `#5a5573`        | `#9892b3` / `#a8a3c0`            | Timestamps, previews, hints       |
| `--primary-text`              | primary mixed 80% with black | primary mixed 70% with white     | Primary-coloured text on surfaces |
| Primary (`--p`)               | `#6252E0` violet             | same (user accent may change it) | Buttons, own bubble, focus ring   |
| `--online`                    | `#22b07d`                    | `#43d6a3`                        | Presence dot                      |
| `--success-text`              | `#0b7a55`                    | `#43d6a3`                        | Success text                      |
| `--warning-text`              | `#8a5a00`                    | `#f5b544`                        | Warning text                      |
| `--error-text`                | `#c42b47`                    | `#ff7a92`                        | Error text                        |

**Accents.** The primary colour can be changed in Settings, Appearance: violet (default), blue, green, orange, pink,
teal. Only `--p` changes; everything built on it follows (own bubble, buttons, focus ring).

**Shape and motion tokens.** Radii `--r-xs` 6, `--r-sm` 10, `--r-md` 14, `--r-lg` 20, `--r-pill`; easing `--ease-out`
and `--ease-spring`; durations 120, 180, 280 ms. Elevation: `--shadow-1` (resting), `--shadow-2` (menus), `--shadow-3`
(modals). Settings also offer corner style (rounded or sharp) and density (comfortable or compact).

## Contrast numbers (WCAG 2.x, computed from the token values)

| Pair                                            | Ratio                                                                | AA (4.5:1 for text) |
| ----------------------------------------------- | -------------------------------------------------------------------- | ------------------- |
| Light: `--text-1` on surface / on canvas        | 16.9 / 15.5                                                          | pass                |
| Light: `--text-2` on surface / canvas / sunken  | 7.0 / 6.4 / 5.9                                                      | pass                |
| Light: `--text-3` on surface / canvas           | 5.4 / 5.0                                                            | pass                |
| Light: received link `#4b3fc4` on white         | 7.5                                                                  | pass                |
| Light: success / warning / error text on white  | 5.3 / 5.9 / 5.6                                                      | pass                |
| Light: own bubble, white text on solid primary  | about 5.4 (plain brand `#6252E0` would be 4.0, hence the deeper mix) | pass                |
| Dark: `--text-1` on surface                     | 14.7                                                                 | pass                |
| Dark: `--text-2` on surface / sunken            | 7.3 / 8.1                                                            | pass                |
| Dark: `--text-3` on surface / raised            | 5.9 / 5.3                                                            | pass                |
| Dark: success / warning / error text on surface | 9.5 / 9.7 / 7.1                                                      | pass                |

The test file enforces the meta-text rule on every surface in both themes. The own-bubble figure comes from the comment
next to the token in `index.css` (the colour is computed with `color-mix` and `oklch`, so it was not recomputed by hand).

## Bubbles and links

| Token                 | Light                                                  | Dark                                    |
| --------------------- | ------------------------------------------------------ | --------------------------------------- |
| `--bubble-sent-bg`    | primary mixed 80% with `#1a1030`, solid                | primary mixed 72% with `#1a1030`, solid |
| `--bubble-sent-color` | `#ffffff`                                              | `#ffffff`                               |
| `--bubble-sent-meta`  | white at 90%                                           | white at 88%                            |
| `--bubble-sent-link`  | `#d4efff` (soft sky blue, kept at 4.5:1 on the bubble) | `#d4efff`                               |
| `--bubble-recv-bg`    | `#ffffff` with a `#e3e0ee` border                      | `#2a2640` with a faint border           |
| `--bubble-recv-color` | `#1d1a2f`                                              | `#ece9f7`                               |
| `--bubble-recv-link`  | `#4b3fc4`                                              | `#c4baff`                               |

Links inside bubbles are underlined, use these tokens and open in a new tab with `rel="noopener noreferrer"`. Only
`http`, `https` and `mailto` links are ever made clickable (see [ADR-0021](../decisions/0021-markdown-rendering-everywhere.md)).

## Typography

- **Default font: serif** (`Georgia, 'Times New Roman', serif`). Other choices in Settings: Rounded (the system UI stack),
  System (an explicit stack starting `-apple-system`, `Segoe UI`, `Roboto`), Mono. A dyslexia-friendly option and a
  high-contrast mode also exist.
- No web fonts are downloaded; every stack is local.
- **Default size: small (14 px root);** options normal 16, large 18, extra large 20. "Normal" leaves the size to the
  browser so a person's own browser setting still counts.
- Headings use the display font at weight 650 and letter-spacing -0.01em.
- The font settings are written to `--app-font` and `--display-font` on `<html>` before first paint by a small script in
  `index.html`; a test keeps the script and `appearance.ts` in step.

## Components (`apps/web/src/components`)

| Component                                             | Notes                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `Button`, `Input`                                     | daisyUI base with token colours; focus ring is 2 px primary with a 2 px offset (`:focus-visible` only) |
| `Avatar`                                              | Picture or initials fallback                                                                           |
| `Badge`                                               | Unread and missed-call counts                                                                          |
| `Modal`                                               | Focus trap (`useFocusTrap`), scrim, closes on Escape                                                   |
| `PopoverMenu`, `AnchoredPanel`                        | Menus and panels next to a button, see below                                                           |
| `Toast`                                               | Inverse in light mode (`--toast-bg`)                                                                   |
| `EmptyState`, `ErrorState`, `Spinner`, `ReloadButton` | Loading, empty and error states                                                                        |
| App chrome                                            | `Navbar`, `ConnectionStatusBanner` (offline, reconnecting), `FullScreenStates`, `MobileTabBar`         |

## Mobile tab bar

On phones (below the `sm` breakpoint) `MobileTabBar` is fixed to the bottom: four equal tabs (Chats, Calls, People,
Settings), each at least 56 px tall with an icon and a 11 px label, the active tab in `--primary-text` with a heavier
icon stroke, unread and missed-call badges, and `env(safe-area-inset-bottom)` padding above the home indicator. On wider
screens the navigation is the sidebar and top bar.

## Hover only with a pointer

Tailwind runs with `future.hoverOnlyWhenSupported: true`, so every `hover:` utility compiles to
`@media (hover: hover)`. On a phone a tap used to leave `:hover` stuck on the last touched row; now it cannot. Anything
important that was only reachable by hover (for example a message actions chevron) also has a touch route: a long press
or the action sheet.

## Menus are portaled with collision handling

Menus, popovers and panels render into `<body>` through `createPortal` (`PopoverMenu`, `AnchoredPanel`, `Modal`). A header
with `backdrop-filter` or `overflow` would otherwise clip or re-position them. `useAnchoredPosition` measures the anchor
and the panel and:

1. opens below (or above, if asked) the anchor,
2. **flips** to the other side when there is no room,
3. **shifts** horizontally to stay inside the viewport,
4. caps `maxHeight` and `maxWidth` and scrolls inside when the panel is taller than the room,
5. closes on a click on the full-screen backdrop (z-index 65) or Escape.

`placement.ts` holds the pure maths (with unit tests); `PopoverMenu.test.tsx` covers keyboard use.

## Back gestures

On phones the Back button and the back swipe close overlays one at a time, topmost first ([ADR-0024](../decisions/0024-phone-back-navigation-and-gestures.md)).
A touch that starts within 24 px of the left edge and moves right goes back (past a third of the screen width, or a quick
flick), with the page following the finger. Swiping down closes a sheet. Inputs, sliders and sideways scrollers keep their
own touch behaviour. In the installed app, a second Back within 2 seconds at the root leaves the app. New overlays should
call `useBackClose`; call screens and the guide tour are not wired yet.

## Motion and accessibility

`prefers-reduced-motion` and the "Reduce motion" setting turn off blobs, bouncing, fades and slides. `:focus-visible`
rings are on every interactive element; `data-contrast='high'` strengthens outlines. Screen-reader announcements and
labels are covered by the accessibility tests described in [`../testing.md`](../testing.md).
