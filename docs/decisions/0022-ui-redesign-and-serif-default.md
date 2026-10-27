# ADR-0022: Calm solid-surface redesign, serif by default

- **Status:** Accepted (2026-10-27)
- **Related:** [`../design/design-system.md`](../design/design-system.md), [`../design/ui-redesign-spec.md`](../design/ui-redesign-spec.md)

## Context

The first UI was a "pastel glass" toy: translucent frosted panels, drifting blurred blobs, a gradient sent bubble with dark
text and text contrast that depended on what scrolled behind it. It was costly on cheap phones and hard to read.

## Decision

- **Solid surfaces carry content.** Colour is for three things only: the primary action, your own messages and the brand
  mark. Everything else is neutral with a faint lavender tint. Blur is kept only for the sticky top bar and modal scrims.
- **Design tokens** (CSS variables in `index.css`) drive colour, radius, shadow and motion, for a light theme
  (`pastel-glass`) and a dark theme (`pastel-night`). Text, bubble and link colours are checked against WCAG AA 4.5:1 by a
  test (`theme-contrast.test.ts`).
- **Own bubble** is solid primary with white text (5.4:1 in light mode); received bubbles are solid surface colour.
- **Serif is the default font** (Georgia stack). The redesign briefly made the system font the default, but serif is the
  product's voice, so a settings migration (version 3) puts people back on serif; sans (rounded, system) and mono remain
  options. No web fonts are downloaded.
- **Mobile first:** a bottom tab bar on phones (Chats, Calls, People, Settings), 44 px touch targets, safe-area padding.
- **Hover styles apply only on devices that can hover** (Tailwind `hoverOnlyWhenSupported`), so a tap on a phone never
  leaves a stuck highlight.
- **Menus and popovers are portaled to `<body>`** and positioned with collision handling (flip, shift, scroll inside), so a
  header with `backdrop-filter` or `overflow` cannot clip them.

## Alternatives

- **Keep the glass look and fix contrast case by case.** The cause (translucency) stays.
- **System font default.** Better neutral legibility, but loses the product's character; the font is a setting anyway.

## Trade-offs

Georgia on some devices is wider than the system font, so a few layouts are tested at both. The two-theme token layer
keeps legacy aliases (`--glass-*`) until old markup is gone.

## Consequences

- One place to change look and feel: `apps/web/src/index.css` and `tailwind.config.ts`.
- Docs: [`../design/design-system.md`](../design/design-system.md), [`../features/appearance-and-accessibility.md`](../features/appearance-and-accessibility.md).
