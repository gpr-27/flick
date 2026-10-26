# Flick UI redesign spec

Goal: from "pastel glass toy" to "calm, fast, legible messenger" (WhatsApp/Telegram/Linear polish).
Keep: name Flick, lavender + peach identity, light/dark, daisyUI 4 + Tailwind 3, lucide icons.
No new dependencies, no network fonts (remove the Google Fonts links in `index.html`).

Principle: **solid surfaces carry content; colour and gloss are for 3 things only** (primary action, own
messages, brand mark). Everything else is neutral, with one lavender tint in the neutrals.

---

## 1. Diagnosis: top 15 problems

1. `index.html` (inline script) defaults `fontFamily` to `'serif'` (Georgia). The whole UI, lists, buttons and timestamps are
   serif; it reads like a blog, not an app. `tailwind.config.ts` names Nunito/Quicksand but they are only used when the user picks
   a font. Fix: default `system`; serif becomes an opt-in setting. Remove `fonts.googleapis.com` links (the display font also
   forces a network round-trip).
2. `index.css` `.glass` / `.glass-card` (translucent white 55-72% + `backdrop-filter: blur(20px) saturate(150%)`) are used on
   Navbar, ChatHeader, Sidebar, cards, menus, composer popovers. Text contrast depends on what scrolls behind it, blur is costly on
   low-end phones, and "everything is frosted" flattens hierarchy. Fix: opaque elevation levels (section 2), blur only on the
   sticky top bar and modal scrim.
3. `.app-bg` + `.blobs` drifting 38rem blurred gradients on every page (Settings, SignIn, Profile...). Distracting, constant GPU
   repaint, pastel mud behind text. Fix: flat `--bg-canvas`; keep one static soft glow on SignIn only.
4. `.bubble-sent`: lavender-to-peach vertical gradient with dark ink text `#2e2a45`. The gradient passes through a muddy
   pink-grey mid-tone and the peach end drops contrast; links needed a hotfix. Fix: solid primary `#6252E0` + white text (5.52:1).
5. `.bubble-recv`: translucent white 85% + border + coloured shadow; looks like a card, and in dark it is `rgba(44,38,64,.85)` on a
   gradient so each bubble differs. Fix: opaque `--bubble-recv-bg`, 1px hairline, no shadow.
6. Bubble `px-3.5 py-2.5` + `rounded-2xl rounded-br-md` + `shadow-sm` + `animate-bubble-in` on every bubble
   (`MessageBubble.tsx` ~l.342): heavy, no real grouping tails, every bubble animates (also on history load). Fix: grouped radii
   (section 3.4), animate only newly arrived live messages.
7. `Navbar.tsx`: 16 controls inline on desktop (Install, Theme, Bell, Calls, People, Settings, "?", Profile pill, Clerk
   `UserButton`), and a duplicate avatar (Profile pill + Clerk UserButton). Phones: a "More" kebab hiding Settings/People/Profile
   behind a menu. Tagline "realtime messaging" is noise. Fix: bottom tab bar on phones, slim left rail/top bar on desktop,
   one avatar menu.
8. `ChatHeader.tsx`: up to 8 round buttons (Disappearing, call, video, Flick, group call, info, close). Mixed `size-5` icons in
   `btn-sm` (32px) circles on desktop, 44px only on phones via arbitrary `min-h-[44px]`. Fix: 3 primary actions + overflow menu.
9. `ChatRow.tsx`: card-per-row (`rounded-2xl mb-2` + swipe layer), name serif-bold, time/pin/mute/star/unread all squeezed in two
   lines; phones also get inline call buttons inside rows, and a `MoreVertical`. Dense and noisy, active row not distinct
   enough. Fix: flat 72px row with hairline, WhatsApp layout (section 3.3).
10. `MessageInput.tsx`: an `input-soft` pill with 4-5 `btn-circle btn-ghost btn-sm` (32px, `text-base-content/60`) icons around it
    (emoji, image, camera, clip) plus a hidden-on-phone group; icons are small and faint. Fix: Telegram layout: one rounded field
    with emoji inside-left, attach + camera inside-right, big 44px send/mic circle outside.
11. `.input-soft`: `rgba(255,255,255,.7)` bg, 10% border, 1rem radius, 4px focus halo in `#7c6cf0` hard-coded (does not follow the
    accent setting that overrides `--p`). Fix: solid fill tokens, focus ring from `oklch(var(--p))`.
12. Text hierarchy relies on opacity (`text-base-content/50|60|70|40`) plus a global override that maps /50 and /60 to one colour;
    placeholders at 40% (`--input-placeholder`) fail AA (~2.6:1). Fix: three named text tokens (section 2.3).
13. Radii are inconsistent: `rounded-3xl` (settings cards, 1.5rem), `rounded-2xl`, `rounded-xl`, `rounded-full`, daisy `--rounded-box:
1.5rem`, `--rounded-btn: 1rem`; avatar fallbacks, buttons and chips never match. Fix: radius scale 6/10/14/20/pill.
14. Buttons: only `btn-grad` (diagonal violet to peach gradient with a 30px glow shadow) and `dashed`. Everything else is raw daisy
    `btn-ghost btn-sm` of varying heights (32, 40, 44, 48). No secondary/destructive/quiet system. Fix: 5 variants x 3 sizes with
    fixed heights 32/40/48.
15. Settings (`SettingsPage.tsx`): accordion of `glass-card rounded-3xl` rows, `font-display text-lg font-bold`, `min-h-14`. Looks
    like a FAQ page, not iOS/Telegram grouped lists; there is no summary value on the right, no chevrons. Profile/People/Calls/
    Notifications each use their own card chrome over `.app-bg` + blobs. Empty states (`EmptyState.tsx`) are a faint
    `text-base-content/40` icon + text: low-effort. Dark mode: surfaces `#14111F/#1F1B2E/#2A2540` are too close in lightness
    (L* 7/12/18) so layers blur together; dark primary `#8B7BFF` bubbles use dark text, inconsistent with light.

---

## 2. Design direction and tokens

### 2.1 Colour tokens (put in `index.css`, light in `:root,[data-theme='pastel-glass']`, dark in `[data-theme='pastel-night']`)

Keep existing names where tests/other code read them (`--page-bg`, `--text-meta`, `--text-muted`, `--bubble-*`, `--input-*`,
`--chip-*`, `--toast-*`, `--scroll-*`, `--glass-*` as aliases). Add the new ones. Contrast ratios computed with the WCAG formula.

| token                                             | light                                                                           | dark                          | notes                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------- |
| `--bg-canvas` (= `--page-bg`)                     | `#F5F4FA`                                                                       | `#121019`                     | app background                                      |
| `--bg-surface`                                    | `#FFFFFF`                                                                       | `#1A1726`                     | list panes, cards, header (elevation 1)             |
| `--bg-raised`                                     | `#FFFFFF`                                                                       | `#242036`                     | menus, sheets, modals, composer field (elevation 2) |
| `--bg-sunken`                                     | `#ECEAF4`                                                                       | `#0D0B14`                     | inputs inside surfaces, chips, segmented tracks     |
| `--bg-hover`                                      | `rgba(29,26,47,.05)`                                                            | `rgba(255,255,255,.06)`       | row/button hover                                    |
| `--bg-active`                                     | `#EEEBFD`                                                                       | `#2B2548`                     | selected chat row, active nav item                  |
| `--border`                                        | `#E3E0EE`                                                                       | `rgba(255,255,255,.08)`       | hairlines                                           |
| `--border-strong`                                 | `#CFCAE0`                                                                       | `rgba(255,255,255,.16)`       | inputs                                              |
| `--text-1` (= `--body-color`)                     | `#1D1A2F`                                                                       | `#ECE9F7`                     | primary text                                        |
| `--text-2` (= `--text-meta`, `--text-muted`)      | `#5A5573`                                                                       | `#A8A3C0`                     | secondary, previews, timestamps                     |
| `--text-3` (= `--input-placeholder`)              | `#6B6686`                                                                       | `#9892B3`                     | placeholder, disabled-ish captions                  |
| `--primary` (daisy `primary`)                     | `#6252E0`                                                                       | `#8B7BFF`                     |                                                     |
| `--primary-content`                               | `#FFFFFF`                                                                       | `#14101F`                     |                                                     |
| `--primary-text` (links/active labels on surface) | `#4B3FC4`                                                                       | `#B5A9FF`                     |                                                     |
| `--accent-peach` (daisy `secondary`)              | `#FF9E80`                                                                       | `#FF9E80`                     | brand accent, Flick AI, never for text              |
| `--bubble-sent-bg`                                | `#6252E0`                                                                       | `#5B4BD6`                     | solid                                               |
| `--bubble-sent-color`                             | `#FFFFFF`                                                                       | `#FFFFFF`                     |                                                     |
| `--bubble-sent-meta`                              | `rgba(255,255,255,.9)`                                                          | `rgba(255,255,255,.88)`       | time + ticks on sent                                |
| `--bubble-sent-link`                              | `#FFFFFF` (underlined)                                                          | `#FFFFFF` (underlined)        |                                                     |
| `--bubble-recv-bg`                                | `#FFFFFF`                                                                       | `#2A2640`                     | solid                                               |
| `--bubble-recv-color`                             | `#1D1A2F`                                                                       | `#ECE9F7`                     |                                                     |
| `--bubble-recv-border`                            | `#E3E0EE`                                                                       | `rgba(255,255,255,.06)`       |                                                     |
| `--bubble-recv-link`                              | `#4B3FC4`                                                                       | `#C4BAFF`                     |                                                     |
| `--success` `--warning` `--error`                 | `#0B7A55` `#8A5A00` `#C42B47` (text/icons); fills `#43D6A3` `#F5B544` `#F2607A` | `#43D6A3` `#F5B544` `#FF7A92` |                                                     |
| `--online`                                        | `#22B07D`                                                                       | `#43D6A3`                     | presence dot (3:1 non-text on white ok)             |

Contrast table (all computed):

| pair                                                 | ratio                 | AA                                    |
| ---------------------------------------------------- | --------------------- | ------------------------------------- |
| light text-1 on surface / canvas                     | 16.92 / 15.47         | pass                                  |
| light text-2 on surface / canvas / sunken            | 7.04 / 6.44 / 5.92    | pass                                  |
| light text-3 on surface / canvas                     | 5.43 / 4.96           | pass                                  |
| white on primary `#6252E0` (sent bubble, buttons)    | 5.52                  | pass                                  |
| light primary-text `#4B3FC4` on white (links, recv)  | 7.48                  | pass                                  |
| primary `#6252E0` as text on surface / canvas        | 5.52 / 5.05           | pass                                  |
| sent meta white at 90% on primary                    | about 4.9             | pass (do not go below 0.88)           |
| white on error fill `#C42B47` (badges)               | 5.55                  | pass                                  |
| success text `#0B7A55` on white                      | 5.34                  | pass                                  |
| dark text-1 on canvas / surface / raised             | 15.77 / 14.71 / 13.16 | pass                                  |
| dark text-2 on canvas / surface / raised             | 7.78 / 7.25 / 6.49    | pass                                  |
| dark text-3 on surface                               | 5.94                  | pass                                  |
| dark white on sent `#5B4BD6`                         | 6.14                  | pass                                  |
| dark recv text-1 on `#2A2640` / text-2 on it         | 12.12 / 5.98          | pass                                  |
| dark link `#C4BAFF` on `#2A2640`                     | 8.15                  | pass                                  |
| dark primary-text `#A99BFF` on surface / canvas      | 7.38 / 7.92           | pass (use `#B5A9FF`, slightly higher) |
| dark `#14101F` on primary `#8B7BFF` (buttons, badge) | 5.67                  | pass                                  |
| dark error `#FF7A92` on surface                      | 7.08                  | pass                                  |

Dark elevation steps are now canvas `#121019` (L* ~6), surface `#1A1726` (~10), raised `#242036` (~15): three clearly separate layers.

`theme-contrast.test.ts` parses `--page-bg: #hex`, `--text-meta`/`--text-muted: rgba(r,g,b,a)` and daisy `base-100/200/300`.
Keep those exact formats: `--text-meta: rgba(90, 85, 115, 1)` (light), `rgba(168, 163, 192, 1)` (dark). Map daisy
`base-100 = --bg-surface`, `base-200 = --bg-canvas`, `base-300 = --bg-sunken`. Update the test's "surfaces" only if it fails.

### 2.2 daisyUI theme block (tailwind.config.ts)

Light `pastel-glass`: primary `#6252E0`, primary-content `#FFFFFF`, secondary `#FF9E80`, secondary-content `#3A2620`,
accent `#22B07D`, accent-content `#FFFFFF`... (use `#06372b` on `#6FE3C2` as today if accent is kept), neutral `#1D1A2F`,
neutral-content `#F5F4FA`, base-100 `#FFFFFF`, base-200 `#F5F4FA`, base-300 `#ECEAF4`, base-content `#1D1A2F`,
info `#6252E0`, success `#43D6A3`, warning `#F5B544`, error `#E04561`.
Dark `pastel-night`: primary `#8B7BFF`, primary-content `#14101F`, base-100 `#1A1726`, base-200 `#121019`, base-300 `#242036`,
base-content `#ECE9F7`, neutral `#ECE9F7`, neutral-content `#1A1726`, error `#FF7A92`.
Both: `--rounded-box: 1.25rem; --rounded-btn: 0.875rem; --rounded-badge: 9999px; --animation-btn: 0.15s; --btn-focus-scale: 0.98`.
Keep the Settings accent override mechanism (`--p`/`--pc` set from `index.html`/appearance.ts); build tints with `oklch(var(--p) / x)`
and not hard-coded hex (`.input-soft:focus` and `.btn-grad` shadow currently hard-code `#7c6cf0`).

### 2.3 Radii, spacing, shadows, motion

```css
:root {
  --r-xs: 6px;
  --r-sm: 10px;
  --r-md: 14px;
  --r-lg: 20px;
  --r-pill: 9999px; /* bubbles 18px, see 3.4 */
  /* spacing: 4px base. Use Tailwind 1/2/3/4/6/8/12 only; list gutter px-4 (phone) px-5 (desktop) */
  --shadow-1: 0 1px 2px rgba(29, 26, 47, 0.06), 0 1px 1px rgba(29, 26, 47, 0.04); /* cards */
  --shadow-2:
    0 6px 20px -6px rgba(29, 26, 47, 0.18), 0 2px 6px rgba(29, 26, 47, 0.06); /* menus, popovers */
  --shadow-3: 0 24px 60px -16px rgba(29, 26, 47, 0.35); /* modals */
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --dur-fast: 120ms;
  --dur-base: 180ms;
  --dur-slow: 280ms;
}
[data-theme='pastel-night'] {
  --shadow-1: 0 0 0 1px rgba(255, 255, 255, 0.06);
  --shadow-2: 0 8px 24px -8px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.07);
  --shadow-3: 0 28px 70px -16px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.08);
}
```

Tailwind: map `boxShadow.soft/glow/glasscard` to `--shadow-2/--shadow-2/--shadow-3` (keep the keys; code uses them). Replace
`animation` timings: `fade-in-up 0.55s` -> `0.22s var(--ease-out)`, `bubble-in 0.35s` -> `0.18s` with `translateY(4px) scale(.98)`,
`scale-in 0.4s` -> `0.18s`. Rule: nothing longer than 280ms except call rings and skeleton.
`@media (prefers-reduced-motion)` block already exists: keep it.

### 2.4 Fonts and type scale

```css
:root {
  --font-ui:
    -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', Roboto,
    'Helvetica Neue', Inter, system-ui, sans-serif;
  --font-serif: Georgia, 'Times New Roman', serif;
}
body {
  font-family: var(--app-font, var(--font-ui));
  font-feature-settings: 'cv11', 'ss01';
  font-variant-numeric: tabular-nums;
}
h1,
h2,
h3,
.font-display {
  font-family: var(--display-font, var(--font-ui));
  letter-spacing: -0.01em;
  font-weight: 650;
}
```

Tailwind `fontFamily.sans = ['var(--app-font, var(--font-ui))', ...]`, `display = ['var(--display-font, var(--font-ui))']`. Drop Nunito/Quicksand.
`index.html`: `var family = saved.fontFamily || 'system'`; delete the three Google Fonts `<link>`s. `appearance.ts` default `system`
(update `appearance.test.ts` expectations for the default only). Serif stays a choice in Settings > Appearance.
Apply `tabular-nums` only on time/counters (`tabular-nums` class), not body, to avoid odd digits in prose: use class on `<time>`, badges.

| role                                                                                                                       | size / line-height / weight                                                                         | use                                       |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| display                                                                                                                    | 28/34/700                                                                                           | sign-in title, empty-state hero           |
| title-1                                                                                                                    | 22/28/650                                                                                           | page titles                               |
| title-2                                                                                                                    | 17/24/650                                                                                           | header name, section titles, modal titles |
| body                                                                                                                       | 16/24/400 (message text 15.5/22 is fine: use `text-[15px] leading-[22px]` on desktop, 16 on phones) | messages, inputs                          |
| row-title                                                                                                                  | 16/22/600                                                                                           | chat name                                 |
| row-sub                                                                                                                    | 14/20/400 text-2                                                                                    | previews, descriptions                    |
| caption                                                                                                                    | 12/16/500 text-2                                                                                    | time, meta, badges (min 11px for badges)  |
| overline                                                                                                                   | 11/14/650 uppercase tracking-wide text-2                                                            | group headers in lists                    |
| Root font size stays user-controlled (small=?, see `index.html` sizes); express everything in `rem` so the setting scales. |

---

## 3. Component specs

### 3.0 Shared CSS (replace/add in `index.css` `@layer components`)

```css
.app-bg {
  background: var(--bg-canvas);
} /* no gradient */
.blobs {
  display: none;
} /* neutralise; SignIn gets .glow below */
.glow-top {
  background: radial-gradient(600px 300px at 50% -10%, oklch(var(--p) / 0.16), transparent 70%);
}
.glass {
  background: color-mix(in srgb, var(--bg-surface) 88%, transparent);
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  border-bottom: 1px solid var(--border);
} /* top bars only */
.glass-card {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-1);
} /* opaque card */
.surface {
  background: var(--bg-surface);
}
.surface-raised {
  background: var(--bg-raised);
  box-shadow: var(--shadow-2);
  border: 1px solid var(--border);
}
.bubble-sent {
  background: var(--bubble-sent-bg);
  color: var(--bubble-sent-color);
}
.bubble-recv {
  background: var(--bubble-recv-bg);
  color: var(--bubble-recv-color);
  border: 1px solid var(--bubble-recv-border);
}
.input-soft {
  width: 100%;
  min-height: 44px;
  background: var(--bg-sunken);
  border: 1px solid transparent;
  border-radius: var(--r-md);
  padding: 0.6rem 0.9rem;
  color: var(--text-1);
  transition:
    border-color var(--dur-fast),
    box-shadow var(--dur-fast),
    background-color var(--dur-fast);
  outline: none;
}
.input-soft::placeholder {
  color: var(--text-3);
}
.input-soft:hover {
  border-color: var(--border-strong);
}
.input-soft:focus {
  background: var(--bg-surface);
  border-color: oklch(var(--p));
  box-shadow: 0 0 0 3px oklch(var(--p) / 0.22);
}
.btn-grad {
  background: oklch(var(--p));
  color: oklch(var(--pc));
  border: none;
  box-shadow: var(--shadow-1); /* keep class name, solid look */
  background-image: linear-gradient(180deg, oklch(var(--p) / 1), oklch(var(--p) / 0.92));
}
.btn-grad:hover {
  filter: brightness(1.06);
}
.btn-grad:active {
  transform: scale(0.98);
}
.chip {
  background: var(--bg-sunken);
  color: var(--text-2);
  border-radius: var(--r-pill);
  padding: 0.2rem 0.65rem;
  font-size: 0.75rem;
  font-weight: 600;
}
:focus-visible {
  outline: 2px solid oklch(var(--p));
  outline-offset: 2px;
}
.skeleton-line {
  background: linear-gradient(
    90deg,
    var(--bg-sunken) 25%,
    var(--bg-hover) 37%,
    var(--bg-sunken) 63%
  );
  background-size: 400% 100%;
  animation: shimmer 1.4s ease infinite;
  border-radius: var(--r-xs);
}
@keyframes shimmer {
  0% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0 50%;
  }
}
```

`.btn-grad` keeps its name (tests/code use it) but stops being a loud gradient; peach appears only in the logo mark and Flick AI.
`--bubble-sent-image` / `--bubble-*-shadow` vars: keep defined (`none`) so no one breaks.
Links in bubbles: keep the existing selectors, set sent link colour to `var(--bubble-sent-link)` (white, underline), recv to
`var(--bubble-recv-link)`; remove `color-mix` hack.

### 3.1 App shell and navigation (`components/app/Navbar.tsx`, `App.tsx`)

Information architecture: 4 destinations: **Chats** (/), **Calls** (/calls), **People** (/people), **Settings** (/settings) (Profile
lives inside Settings header and avatar menu; Notifications is the bell in the Chats header).

Phones (`sm:hidden`): new `MobileTabBar` (new file `components/app/MobileTabBar.tsx`, rendered by `App.tsx` when signed in and not
inside an open chat or call):

```tsx
<nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 border-t border-base-content/10 bg-base-100/95 backdrop-blur
  pb-[env(safe-area-inset-bottom)] sm:hidden">
  <ul className="mx-auto grid max-w-md grid-cols-4">
    <li><NavLink to="/" end className={({isActive}) => cn('flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
        isActive ? 'text-primary-text' : 'text-[var(--text-2)]')}>
      <span className="relative"><MessageSquare className="size-6" /> {unread>0 && <Badge variant="count" className="absolute -right-3 -top-1.5" />}</span>Chats</NavLink></li>
    ...Calls / People / Settings
```

Active state: icon filled stroke 2.5 and label `text-primary`, no pill. Content area gets `pb-[calc(3.5rem+env(safe-area-inset-bottom))]`.

Phone top bar (the existing `<header>` stays, since `Navbar.test.tsx` asserts role `banner` + `max-sm:hidden` when a chat is open):
h-12, logo mark (24px, gradient allowed) + "Flick" title-2 on the left, right side: Bell (BellLink) + `UserButton` only. Remove the
kebab `PhoneMenu` items that now live in tabs, keep it ONLY for theme/install/tour (rename nothing: label stays "More", test uses it).

Desktop/tablet (`sm:` up): single top bar `h-14`, `border-b border-base-content/10 bg-base-100`, no `glass` gradient:

```tsx
<header className="fixed top-0 z-40 w-full border-b border-base-content/10 bg-base-100/90 backdrop-blur pt-[env(safe-area-inset-top)] ...">
  <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-2 px-4 sm:px-5">
    logo (size-8 rounded-[10px] bg-gradient-to-br from-primary to-secondary — test-stable class) + "Flick" text-[17px] font-bold
    <nav className="ml-6 flex items-center gap-1" aria-label="Main">   {/* text tabs */}
      <NavLink className="rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--text-2)] hover:bg-[var(--bg-hover)] aria-[current=page]:bg-[var(--bg-active)] aria-[current=page]:text-primary-text">Chats / Calls / People</NavLink>
    <div className="ml-auto flex items-center gap-1"> InstallButton, ThemeToggle, BellLink, Settings icon button, UserButton </div>
```

Remove: tagline, the Profile pill (duplicate of UserButton; Profile reachable from Settings and the avatar menu), the "?" tour button
(move to Settings > About and PhoneMenu). Keep `aria-label="Flick home"` on the logo link, `aria-label="Account"` nav (the
right-hand cluster), `data-guide="nav.calls"` and `"nav.settings"` (guide spotlights), and the "Take the tour" accessible name wherever it lives.
Icon buttons: `btn btn-ghost btn-circle size-10` (40px; 44px hit area via existing `.tap-target`).

Page container for non-chat routes: `<main className="min-h-dvh-screen bg-base-200 pt-[calc(3.5rem+env(safe-area-inset-top))] max-sm:pt-[calc(3rem+env(safe-area-inset-top))]"><div className="mx-auto max-w-2xl px-4 pb-24 sm:pb-12">`.

### 3.2 Buttons (`components/ui/Button.tsx` + `index.css`)

Variants (keep prop name `variant`; keep `gradient` and `dashed` working; add): `primary` (= gradient, alias), `secondary`, `ghost`, `danger`, `dashed`.

```ts
VARIANTS = {
  gradient: 'btn-grad font-semibold', // keep key
  primary: 'btn-grad font-semibold',
  secondary: 'bg-base-300 text-base-content font-semibold hover:bg-base-content/10',
  ghost: 'text-base-content hover:bg-[var(--bg-hover)] font-medium',
  danger: 'bg-error text-error-content font-semibold hover:brightness-95',
  dashed:
    'border border-dashed border-base-content/25 font-semibold text-[var(--text-2)] hover:bg-[var(--bg-hover)]',
};
SIZES = {
  sm: 'h-8 rounded-[10px] px-3 text-sm',
  md: 'h-10 rounded-xl px-4 text-[15px]',
  lg: 'h-12 w-full rounded-xl text-base',
}; // keep md/lg keys
base: 'inline-flex items-center justify-center gap-2 transition-[transform,background-color,filter] duration-150 active:scale-[.98] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-primary';
```

Icon buttons: `size-10 rounded-full grid place-items-center text-[var(--text-2)] hover:bg-[var(--bg-hover)] hover:text-base-content`. Never put
`/60` opacity on interactive icons.

### 3.3 Chat list (`Sidebar.tsx`, `features/chatlist/ChatRow.tsx`, `SidebarSkeleton.tsx`)

Sidebar column: `w-full sm:w-[360px] lg:w-[400px] border-r border-base-content/10 bg-base-100`, no `glass-card`/rounded-3xl wrapper; fills height.
Header (h-14 on desktop, hidden on phone since the top bar shows the title): title "Chats" title-1, `New chat` button
(`btn-circle size-10 bg-primary text-primary-content`, name "New chat" stable). Search: `Input` with `input-soft rounded-xl h-10`
and a leading search icon; filters as a horizontally scrollable pill row (`tab` role kept, e.g. name "Unread"):

```tsx
<div role="tablist" className="flex gap-2 overflow-x-auto px-4 pb-2 scroll-slim">
  <button role="tab" aria-selected className={cn('h-8 shrink-0 rounded-full px-3.5 text-sm font-medium',
     sel ? 'bg-primary text-primary-content' : 'bg-[var(--bg-sunken)] text-[var(--text-2)] hover:bg-[var(--bg-hover)]')}>
```

Row (`ChatRow.tsx`, keep `<li role="option" data-conversation-id data-guide>` and swipe layer):

```tsx
// li (card wrapper): replace 'mb-2 rounded-2xl' with 'rounded-none'; selected: bg-[var(--bg-active)]
<li className="group relative select-none outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
 <div className="relative overflow-hidden">                       // swipe container unchanged
  <div className={cn('flex min-h-[72px] items-center gap-3 px-4 py-2.5 transition-colors',
        active ? 'bg-[var(--bg-active)]' : 'bg-base-100 hover:bg-[var(--bg-hover)] active:bg-[var(--bg-hover)]')}>
   <Avatar size="md" ... />   {/* 52px: set md to size-[52px] */}
   <div className="min-w-0 flex-1 border-b border-base-content/5 pb-2.5 -mb-2.5">   {/* hairline starts after avatar */}
     <div className="flex items-baseline justify-between gap-2">
        <span className={cn('truncate text-base', unread ? 'font-semibold' : 'font-medium')}>{name}</span>
        <time className={cn('shrink-0 text-xs tabular-nums', unread ? 'font-semibold text-primary-text' : 'text-[var(--text-2)]')}>
     </div>
     <div className="mt-0.5 flex items-center justify-between gap-2">
        <p className={cn('truncate text-sm', unread ? 'text-base-content' : 'text-[var(--text-2)]')}>  // draft prefix text-error font-medium "Draft:" (test expects text-primary -> keep text-primary)
        <span className="flex shrink-0 items-center gap-1.5">
           muted/pin icons size-4 text-[var(--text-2)]; unread: <Badge variant="count"/> (muted chats: bg-base-content/30)
```

Unread badge: `h-5 min-w-5 rounded-full bg-primary px-1.5 text-[11px] font-bold tabular-nums text-primary-content`; the manual-unread dot stays `size-2.5 bg-primary`.
Presence dot via Avatar `online`: `size-3.5 border-2 border-base-100 bg-[var(--online)]`.
Remove inline per-row call buttons on phones (`callable` block) and the always-visible `MoreVertical` on phones (keep on `sm:` hover:
`opacity-0 group-hover:opacity-100`; long-press and swipe remain). Group header above pinned/other: overline style.
Skeleton row: 52px circle + two `.skeleton-line` bars (`h-3.5 w-2/5`, `h-3 w-3/5`), 8 rows.

### 3.4 Chat header (`ChatHeader.tsx`)

```tsx
<header className="flex h-14 items-center gap-2 border-b border-base-content/10 bg-base-100/95 px-2 backdrop-blur sm:px-4 pt-[env(safe-area-inset-top)]">
  back: btn btn-ghost btn-circle size-10 min-h-[44px] min-w-[44px] sm:hidden   (keep those classes: tests)
  <button className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-1 text-left hover:bg-[var(--bg-hover)]">   // opens ContactInfo (keep it a button/trigger as now)
     <Avatar size="sm"/>   // 40px
     <div className="min-w-0"><h2 className="truncate text-[17px] font-semibold leading-tight">Name</h2>
        <p className={cn('truncate text-[13px] leading-tight', busy ? 'font-medium text-primary-text' : 'text-[var(--text-2)]')}>online / typing...</p></div>
  actions (right): voice call, video call (icon buttons size-10, text-base-content not /70), then ONE overflow
  `<PopoverMenu label="Chat options" ...>` containing: Search, Disappearing messages, Flick (sparkles), Group call, Contact/Group info, Close.
```

Max 3 visible controls on phone (back, call, video + overflow = 4 targets including back), 4 on desktop (call, video, search, overflow).
Keep accessible names: "Chat options", the call buttons' current labels, the Flick/Group-call/Info labels (they move into the menu as
`menuitem`s with identical names). `X` close button stays `hidden sm:inline-flex`.
ContactInfo: sectioned like iOS: large avatar (`size-28` stays: test) centred, name title-1, status text-2; actions row of 3-4 square
tiles (`flex-1 rounded-xl bg-[var(--bg-sunken)] py-3 gap-1 text-xs font-medium text-primary-text`, icon size-6); grouped list sections
(see 3.9 list pattern); destructive items (Block, Delete chat) in a final section with `text-error`.

### 3.5 Message list and bubbles (`MessageBubble.tsx`, `VirtualMessageList.tsx`)

Message pane background: `bg-base-200` flat (wallpaper setting overrides remain). Gutter `px-3 sm:px-6`. Max width `max-w-[82%] sm:max-w-[65%]`
(keep `max-w-[85%] sm:max-w-[65%]` if tests grep; tests do not). Line spacing: same sender within 5 min -> `pt-0.5` (2px); new group -> `pt-2` (8px).
Bubble classes (replace the `cn(...)` at ~l.342; **keep `touch-pan-y`, `overflow-hidden`, `animate-bubble-in` only when `isNew`, `ring-2 ring-primary` when highlighted**):

```tsx
'relative touch-pan-y overflow-hidden px-3 py-[7px] text-[15px] leading-[22px] [-webkit-touch-callout:none] [@media(pointer:coarse)]:select-none sm:px-3.5',
isMine ? 'bubble-sent' : 'bubble-recv',
// radius by group position (startsGroup / endsGroup already exist):
isMine
  ? cn('rounded-[18px]', !startsGroup && 'rounded-tr-[6px]', !endsGroup && 'rounded-br-[6px]', endsGroup && 'rounded-br-[6px]')   // tail corner on the last bubble
  : cn('rounded-[18px]', !startsGroup && 'rounded-tl-[6px]', !endsGroup && 'rounded-bl-[6px]', endsGroup && 'rounded-bl-[6px]'),
```

Simplified rule: every bubble is 18px; the corner touching the sender side is 6px on all bubbles except a single (start+end) bubble
which gets the full tail corner 4px. No `shadow-sm`, no coloured shadow.
Sender name in groups: `text-xs font-semibold` keep per-member colours but ensure each of `senderColor` meets 4.5:1 on `--bubble-recv-bg`
in both themes (sample from a palette of 8 hues at L~38% light, L~75% dark).
Timestamp/status row: move INSIDE the bubble at the bottom-right, WhatsApp style, so bubbles are compact:

```tsx
<span
  className="float-right ml-3 mt-1 inline-flex translate-y-[3px] items-center gap-1 text-[11px] tabular-nums leading-none"
  style={{ color: isMine ? 'var(--bubble-sent-meta)' : 'var(--text-2)' }}
>
  <time /> {edited && 'edited'} {ticks}
</span>
```

(if the existing structure under the bubble must stay for tests, keep it but restyle: `text-[11px] text-[var(--text-2)]`, `px-1`, `mt-0.5`; do
not add `/60` opacity.) Ticks: `size-4`; sent `Check` = `text-white/80`, delivered `CheckCheck` same, read `CheckCheck` `text-[#9FE8FF]` on sent
(contrast of ticks vs `#6252E0` >= 3:1 non-text: `#9FE8FF` ~ 6:1). Failed: `text-error` with Retry button (keep "Retry" name).
Reply quote inside bubble: `mb-1.5 flex gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] border-l-[3px]`;
sent: `bg-white/15 border-white/70 text-white`; recv: `bg-[var(--bg-active)] border-primary text-[var(--text-1)]`;
author line `font-semibold`; quote text `line-clamp-2 text-[var(--text-2)]` on recv, `text-white/90` on sent.
Reactions: `-mt-2 ml-2` pill `h-6 rounded-full bg-base-100 border border-base-content/10 px-1.5 text-xs shadow-sm`, own reaction `bg-[var(--bg-active)] border-primary/40`.
Link preview card (inside bubble, under text): `mt-2 overflow-hidden rounded-xl border`; sent `border-white/25 bg-white/10`,
recv `border-base-content/10 bg-[var(--bg-sunken)]`; thumbnail `aspect-[1.91/1] object-cover` full width, body `px-3 py-2`, title
`text-sm font-semibold line-clamp-2`, domain `text-xs` text-2 / white-90.
Media: images `rounded-xl max-h-80 object-cover`, bubble padding `p-1` when the message is image-only, caption below with `px-2 pb-1`.
Date separator (`l.182-190`): `chip` -> `mx-auto my-3 w-fit rounded-full bg-base-100/90 px-3 py-1 text-xs font-medium text-[var(--text-2)] shadow-[var(--shadow-1)]` (no uppercase).
Unread divider (`data-testid="unread-divider"`): `text-xs font-semibold text-primary-text` with `bg-primary/20` lines (not 30% uppercase).
Typing indicator (l.647): `bubble-recv rounded-[18px] rounded-bl-[6px] px-4 py-3` with 3 dots `size-1.5 bg-[var(--text-3)] animate-bounce` staggered.
Hover action buttons (reply/chevron, l.493): `size-7 rounded-full bg-base-100 shadow-[var(--shadow-1)] text-[var(--text-2)] hover:text-primary-text`.
Scroll-to-bottom FAB: `size-10 rounded-full bg-base-100 shadow-[var(--shadow-2)] border border-base-content/10` with `new-count` badge (testid stays).

### 3.6 Composer (`MessageInput.tsx` ~l.1022-1160)

```tsx
<form aria-label="Send a message" className="border-t border-base-content/10 bg-base-100 px-2 py-2 pb-[max(.5rem,env(safe-area-inset-bottom))] sm:px-4">
 <div className="flex items-end gap-2">
   <div className="flex min-h-11 min-w-0 flex-1 items-end rounded-[22px] bg-[var(--bg-sunken)] pl-1.5 pr-1 ring-1 ring-transparent focus-within:bg-base-100 focus-within:ring-2 focus-within:ring-primary/60">
      <button aria-label="Insert emoji" className="grid size-10 shrink-0 place-items-center rounded-full text-[var(--text-2)] hover:text-base-content"><Smile className="size-6"/></button>
      <textarea id="composer-input" className="max-h-40 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-1 py-[10px] text-base leading-6 outline-none placeholder:text-[var(--text-3)]"/>   // drop 'input-soft' here; keep id + sr-only label
      <button aria-label="Attach file" ...Paperclip size-6/>  <button aria-label="Take photo" ...Camera size-6 (hidden when text present)/>
   </div>
   <button aria-label="Send message" className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-content shadow-[var(--shadow-1)] transition active:scale-95"><Send className="size-5"/></button>
   // when textarea empty: the same slot shows aria-label="Record voice message" with the same classes (both keep size-11 rounded-full: responsive.test)
```

Keep names: "Insert emoji", "Take photo", "Record voice message", "Send message", "Send a message" (form), existing image/attach labels,
"Suggest replies", "Send question", "Send poll". Extras (image, poll, schedule, etc.) go into the `ComposerToolsSheet` (+ button inside field on phones).
Reply/edit bar above field: `mx-2 mb-2 flex items-center gap-2 rounded-xl border-l-[3px] border-primary bg-[var(--bg-active)] px-3 py-2`, title `text-xs font-semibold text-primary-text` (id `compose-context`), text `text-sm text-[var(--text-2)] truncate`, close `size-8 rounded-full`.
Emoji picker popover: `surface-raised rounded-2xl p-2 grid-cols-8` (must keep `bottom-full` + `grid`; PhoneLayout.test) not `glass-card`.
Attachment preview chip: `rounded-xl bg-[var(--bg-sunken)] p-2`; remove ring-2; remove button `size-6` -> `size-7`.
Drag overlay: `ring-2 ring-inset ring-primary` kept.

### 3.7 Modals, sheets, menus, toasts

Modal (`Modal.tsx` overlay): `bg-black/50 backdrop-blur-[2px] animate-fade` (opacity-only 150ms). **Keep** the classes asserted by
`responsive.test.tsx`: overlay `max-sm:items-end items-center sm:p-4`; dialog `w-full sm:w-80`. Panel (children callers): `surface-raised w-full sm:w-96 rounded-t-3xl sm:rounded-2xl p-5 shadow-[var(--shadow-3)]`
with a `h-1 w-9 rounded-full bg-base-content/20 mx-auto mb-3 sm:hidden` grab handle; enter animation `translate-y-full -> 0` on phones
(`280ms var(--ease-out)`), `scale-in` (180ms) on desktop. Title `text-[17px] font-semibold`, body `text-sm text-[var(--text-2)]`, buttons row
`mt-5 flex gap-2` with `flex-1` buttons on phones (Cancel = secondary, confirm = primary/danger).
`PopoverMenu`: `surface-raised min-w-56 rounded-2xl p-1.5`, items `flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] hover:bg-[var(--bg-hover)]` (keep `min-h-12`/`min-h-11` assertion: responsive.test expects `min-h-` classes on menuitems; do not shrink below 44px), destructive `text-error`, icons `size-5 text-[var(--text-2)]`, separators `my-1 h-px bg-base-content/10`.
Toast (`Toast.tsx`): `rounded-xl bg-[var(--toast-bg)] text-[var(--toast-color)] shadow-[var(--shadow-2)] px-4 py-3 text-sm`, solid dark `#1D1A2F` toast in light mode (inverse, white text 16.9:1) and `#ECE9F7`-on-`#242036` in dark; status icon left (success `text-success`, error `text-error`), position `bottom-[calc(4.5rem+env(safe-area-inset-bottom))]` on phones (clears tab bar/composer), `top-4` right on desktop; enter 180ms slide+fade. `role="status"` unchanged.
Skeletons: `.skeleton-line` (above); message skeleton alternating left/right bubbles `h-9 w-40/56 rounded-[18px]`.
Spinner: keep.

### 3.8 Empty and error states (`EmptyState.tsx`, `NoChatSelected.tsx`, `ErrorState.tsx`)

```tsx
<div className="flex flex-col items-center gap-3 px-8 py-14 text-center">
  <div aria-hidden className="grid size-16 place-items-center rounded-2xl bg-[var(--bg-active)] text-primary-text [&>svg]:size-8">{icon}</div>
  <p className="text-[17px] font-semibold">{title}</p>
  {description && <p className="max-w-[18rem] text-sm leading-relaxed text-[var(--text-2)]">{description}</p>}
  {action && <Button variant="primary" size="md">{label}</Button>}
```

NOTE: `EmptyState.tsx` currently does not destructure `action` (it is in the props but missing from the parameter list, and the file is in the
modified set); whoever edits it must destructure `action`. NoChatSelected (desktop right pane): logo mark `size-20`, "Flick" display, line "Select a chat or start a new one", primary button "New chat". Static `glow-top` behind it, no blobs.
Per-screen copy: Chats "No chats yet / Find people and say hello" + button "Find people"; Calls "No calls yet / Your call history will show up here"; Notifications "You're all caught up".

### 3.9 Grouped list pattern (Settings, Profile, ContactInfo, People rows)

```tsx
<section aria-labelledby=..><h2 className="px-4 pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-2)]">Notifications</h2>
 <ul className="overflow-hidden rounded-2xl border border-base-content/10 bg-base-100 divide-y divide-base-content/5">
  <li><button className="flex min-h-14 w-full items-center gap-3 px-4 text-left hover:bg-[var(--bg-hover)] active:bg-[var(--bg-hover)]">
     <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-content [&>svg]:size-[18px]"><Icon/></span>   // icon tile: vary tile colour per section (primary, #E0457B, #22B07D, #E08A1E, #3B82F6) all with white icon >= 3:1
     <span className="min-w-0 flex-1"><span className="block text-base">Title</span><span className="block truncate text-sm text-[var(--text-2)]">value / description</span></span>
     <ChevronRight className="size-5 shrink-0 text-[var(--text-3)]" aria-hidden/>
```

Toggles keep native `role="switch"` (names such as "Push notifications" are tested): `toggle toggle-primary`. Section footer help text `px-4 pt-1.5 text-xs text-[var(--text-2)]`.

### 3.10 Profile, Settings, People, Calls, Notifications, Sign-in

- **Settings** (`SettingsPage.tsx`): replace the accordion-of-cards with the grouped list: top profile card (avatar `size-16`, name title-2,
  username text-2, chevron to /profile), then groups: Account (Profile, Privacy, Blocked), Chats (Appearance, Chats, Storage), Notifications
  (Notifications, Calls), AI (Flick), About. On desktop keep the left nav (`grid-cols-[14rem_1fr]`) but restyle: nav items
  `h-10 rounded-lg px-3 text-sm font-medium`, active `bg-[var(--bg-active)] text-primary-text`, no glass; right pane = grouped lists. Phones: list rows push into the
  existing section content (keep `id="settings-<id>"` and the section titles because tests find them by name). Page title `text-[22px] font-bold`.
  Remove `blobs`, `animate-fade-in-up` stays (now 220ms).
- **Profile** (`ProfilePage.tsx`): cover-less header: centred `size-28` avatar (class kept) with an edit badge `absolute bottom-0 right-0 size-9 rounded-full bg-primary text-primary-content border-4 border-base-100`, name input large, then grouped list for fields (Name, Username with availability hint `text-success`/`text-error`, About), sticky bottom Save bar `fixed inset-x-0 bottom-0 border-t bg-base-100 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))]` appearing only when dirty (unsaved guard unchanged). Button name "Save" stable.
- **People** (`PeoplePage.tsx`, `PeopleDirectory.tsx`): sticky search `input-soft` at top; list rows 64px (Avatar 44, name 16/600, username 14 text-2, trailing "Message" `btn-sm secondary` button); letter headers `sticky top-0 bg-base-200 px-4 py-1 text-xs font-semibold text-[var(--text-2)]` (keep `data-letter-header`, `role="listitem"`); Invite button as first row with icon tile.
- **Calls** (`CallLogPage.tsx`): rows like chat rows: avatar, name (missed calls `text-error`), line 2 `Phone/Video` icon + "Incoming/Outgoing/Missed" + time; trailing call-back icon button `size-10 text-primary-text`. Filter pills All / Missed. Call screens (`CallOverlay.tsx`, `IncomingCallModal.tsx`): full-bleed `bg-[#0E0B1A]` (not glass), remote video `object-cover`, top gradient scrim `from-black/50`, bottom controls: row of 56px circles (`size-14 rounded-full bg-white/15 text-white backdrop-blur`), end-call `bg-error size-16`, mute/camera toggled state `bg-white text-black`; labels `text-xs text-white/85` under buttons; self view `rounded-2xl w-28 aspect-[3/4] border border-white/20`; incoming: avatar `size-28` with `animate-ring-ripple` rings in `primary/30`, name 28px, Accept `bg-success`-ish `#1FA971` (white text 3.4:1 large controls ok with 56px icon) and Decline `bg-error`, labelled "Accept" / "Decline" (keep existing names).
- **Notifications** (`NotificationsPage.tsx`): day groups with overline headers; rows with icon tile (36px, tinted), title 15/600, sub 14 text-2, time 12; unread rows `bg-[var(--bg-active)]` + 8px primary dot; "Mark all read" as ghost `btn-sm` in header. Empty state per 3.8.
- **Sign-in** (`SignInPage.tsx`): centred column `max-w-sm`, `glow-top` background, logo `size-14 rounded-2xl` gradient (the one place the full lavender-to-peach gradient stays), "Flick" display 28/700, tagline text-2 "Fast, simple messaging", Clerk card with `appearance` variables: `colorPrimary #6252E0`, `colorText #1D1A2F`, `colorBackground #FFFFFF`, `borderRadius 0.875rem`, `fontFamily` inherit; card `border border-base-content/10 shadow-[var(--shadow-2)] rounded-2xl`. Keep `data-testid="sign-in"` / `"sign-up"`.

---

## 4. Implementation order and work packages (4 parallel agents, disjoint file ownership)

Order of dependency: **A first lands the tokens (30-40 min); B, C, D can start immediately by using the token names above** (CSS variables
and `text-primary-text` etc. are defined in A; until merged they fall back harmlessly if each agent uses `var(--x, fallback)` only where the fallback matters). Run `pnpm -C apps/web test` per package; do not edit tests unless the test asserts the old look, and say so in the PR.

Add to `tailwind.config.ts` (A) so others can use utilities: `colors.text1/2/3` not needed, instead use arbitrary `text-[var(--text-2)]`, plus extend `colors: { 'primary-text': 'var(--primary-text)' }` => `text-primary-text`, `bg-active: 'var(--bg-active)'` (`bg-active`), `bg-sunken`, `bg-hover`.

### Package A: tokens, primitives, shell

Owns: `apps/web/src/index.css`, `apps/web/tailwind.config.ts`, `apps/web/index.html` (font default + remove Google Fonts links),
`src/features/settings/appearance.ts` (default font only) + `appearance.test.ts` default expectation, `src/theme-contrast.test.ts` (only if a format change forces it),
`src/components/ui/*` (Avatar, Badge, Button, EmptyState, ErrorState, Input, Modal, PopoverMenu, AnchoredPanel, Spinner, Toast), `src/components/app/*` (Navbar, new `MobileTabBar.tsx`, FullScreenStates, ConnectionStatusBanner), `src/app/App.tsx` (mount the tab bar, content padding).
Priority: (1) index.css tokens + font default, (2) Button/Input/Badge/Avatar sizes (`md` -> 52px), (3) Modal/PopoverMenu/Toast, (4) Navbar + tab bar, (5) EmptyState (destructure `action`).
Must NOT change (tests): Navbar `role=banner` with `max-sm:hidden` while a chat is open on `/` and not on other routes; `aria-label` "Flick home", "Account", "More" (PopoverMenu label), "Take the tour"; `data-guide="nav.calls"|"nav.settings"`; logo box keeps `bg-gradient-to-br size-8` (FlickAssistant/Navbar tests check `bg-gradient-to-br`/`size-8` on the Flick avatar mark); Avatar keeps `size-11` (sm) and `rounded-full`, `size-28` (xl), role `img` with `aria-label` name, "Online" dot role `img`; Modal overlay `max-sm:items-end items-center sm:p-4`, dialog `w-full sm:w-80` (responsive.test), `role="dialog"`/`aria-modal`; PopoverMenu `role="menu"`/`menuitem` with `min-h-*`; `.btn-xs::after`/`.btn-sm::after` 44px hit-area block, `max(100%, 2.75rem)`, 16px input font rule, `touch-action: manipulation`, `.size-11/.size-12/.min-h-11/.min-h-12` pixel floors, `.animate-bounce` + `.blobs::before` entries in the reduced-motion block (keep the `.blobs` selectors even though hidden), and the `html .text-base-content\/60, html .text-base-content\/50 { color: var(--text-meta) }` rule; `--text-meta` / `--text-muted` as `rgba(r, g, b, a)` and `--page-bg: #hex`; the theme names `pastel-glass` / `pastel-night`, `[data-corners]`, `[data-density]`, `[data-motion]` selectors; `.bubble-sent`, `.bubble-recv`, `.btn-grad`, `.input-soft`, `.chip`, `.glass`, `.glass-card`, `.scroll-slim`, `.h-dvh-screen` class names (keep, restyle only).

### Package B: chat list, chat header, contact info

Owns: `features/chat/components/Sidebar.tsx`, `SidebarSkeleton.tsx`, `UserSearch.tsx`, `ChatHeader.tsx`, `ContactInfo.tsx`, `useContactInfo.tsx`, `GroupInfoModal.tsx`, `NoChatSelected.tsx`, `NewChatModals.tsx`, `SharedTab.tsx`, `InviteLinkSection.tsx`, `JoinRequestsSection.tsx`, `features/chatlist/*` (ChatRow, RowMenu, SelectionBar, DeleteChatDialog, previewIcon), `features/notifications/ChatListMenu.tsx`, `features/organise/ChatOptionsMenu.tsx`, `features/chat/components/ChatContainer.tsx` (layout shell only: panes/borders, not the message pipeline).
Must NOT change (tests): `<li role="option" aria-selected data-conversation-id data-guide>` and listbox semantics, swipe/long-press handlers; names "New chat", "Starred messages", "Chat options", "Unlock", "Lock chat", "Leave group", "Delete chat", tab role names ("Unread", "All", etc.) in `chatList.test.tsx`, `Sidebar.test.tsx`, `chatHeader.test.tsx`, `ContactInfo.test.tsx`, `GroupInfoModal.test.tsx`, `groupAndNewChat.test.tsx`, `PhoneLayout.test.tsx`, `chatList.actions.test.tsx` (draft label "Draft:" keeps `text-primary`); header back button classes `min-h-[44px] min-w-[44px] sm:hidden`; if a header action moves into the overflow menu it must keep the same accessible name (tests find call/video buttons by name; verify in `chatHeader.test.tsx` before moving; if a test needs them visible, keep call+video visible and move only Flick/Disappearing/Group call/Info); `heading` name = chat title ("Bob"); `img` name Flick AI.

### Package C: message list, bubbles, composer

Owns: `features/chat/components/MessageBubble.tsx`, `VirtualMessageList.tsx`, `MessageMenu.tsx`, `MessageSkeleton.tsx`, `MessageInfoDialog.tsx`, `MessageInput.tsx`, `ComposerToolsSheet.tsx`, `features/chat/content/*` (renderers, link preview), `features/chat/gestures/*` (visual only), `features/content/ComposerExtras.tsx`, `features/ai/SuggestReplies.tsx`, `features/ai/WriteWithFlick.tsx`.
Must NOT change (tests): bubble element keeps `touch-pan-y` and `overflow-hidden` (`messageGestures.test`, `contentMatrix.test`); `data-guide="message"`, `data-guide="message.status"`, `data-testid` values `avatar-spacer`, `swipe-reply-arrow`, `heart-pop`, `unread-divider`, `new-count`, `floating-date`, `message-scroller`, `waveform`; status icons' `aria-label`s ("Sending", "Not sent", "Sent", "Delivered", "Read") and `role="img"`; "Retry"; `menu` name "Message actions" / `dialog` name "Message actions" with items Reply, Copy, Delete, Report; the highlight ring must stay the only `.ring-primary` element when highlighted (MessageMenu.test asserts none when not highlighted: do not add `ring-primary` to other bubble parts); composer: form name "Send a message", textarea id `composer-input` with its sr-only label, buttons "Insert emoji", "Take photo", "Record voice message", "Send message" (the latter two keep `size-11 rounded-full`), "Send question", "Send poll", "Suggest replies"; emoji dialog name "Emoji picker" keeps `bottom-full` + `grid`; table/code rendering classes `w-max`, `overflow-x-auto`, `[overflow-wrap:anywhere]`, `whitespace-pre-wrap`, `text-left|center|right` cell alignment classes in `RichText` (do not touch `features/content/richText/*`).

### Package D: pages

Owns: `features/profile/*` (ProfilePage, PublicProfilePage, AvatarCropper), `features/settings/SettingsPage.tsx` + `settings/components/*` + `ThemeToggle.tsx`, `features/directory/*`, `features/calllog/*`, `features/calls/components/*`, `features/groupcall/*` (visual), `features/notifications/center/*` (NotificationsPage, BellLink), `features/notifications/{PushPanel,PushPrompt,IncomingBanner,NotificationSettings}.tsx`, `features/auth/components/SignInPage.tsx`, `features/chat/InvitePage.tsx`, `features/chat/HomePage.tsx` (empty/landing only), `features/calendar/*`, `features/guide/*` (visual only), empty-state call sites.
Must NOT change (tests): `data-testid` `sign-in`, `sign-up`, `app-version`, `storage-usage`, `push-status`, `push-test-result`, `permission-status`, `font-preview`, `wallpaper-preview`, `bell-dot`, `guide-card`, `guide-spotlight`, `server-wake`, `where`; Settings section ids `settings-<id>` and section titles/`aria-expanded` toggling used by `sections.test.tsx` / `settingsScreens.test.tsx` (if converting to push-navigation, keep a heading with the same name rendered when the section opens); switch names ("Push notifications"), "Delete account", "Save", "Discard", "Apply", "Go to settings", "Audio & video settings" button names; profile `img` with `size-28`; People `data-letter-header`, `role=listitem`, letter grouping order; `CallNotificationCard`/`IncomingCallModal` Accept/Decline names; unsaved-changes guard behaviour (`useUnsavedGuard`).

### Cross-package rules

- Use only tokens and utilities from section 2 and `text-[var(--text-2)]`-style arbitrary values; do not introduce hex colours in components (exceptions: call screens, icon tiles).
- No `glass`/`glass-card` on content lists, bubbles, cards; no `blobs`; no `font-display` on body-sized text (titles only).
- Every interactive element: >= 40px visual (44px hit area), visible `:focus-visible`, name unchanged.
- Done = `pnpm -C apps/web lint typecheck test` green, screenshots (light + dark, 390px and 1280px) of Chats, open chat, Settings, Profile, Calls, Sign-in attached to the PR.
