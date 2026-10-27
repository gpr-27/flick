# Appearance and accessibility

You can change how Flick looks (theme, accent colour, font, text size, density, corners, wallpaper) and
how it behaves for people who need it (reduce motion, high contrast, a dyslexia-friendly option,
visible focus rings, keyboard use and screen readers). All of these are in Settings > Appearance and
apply at once. They are kept on your device. There is no AI here. Status: Built.

## Related

- [Settings](settings.md): where the switches are
- [Search and organise](search-and-organise.md): wallpapers, per-chat colour
- [Design system](../design/design-system.md): the colour tokens and type scale behind these options
- [Calendar and productivity](calendar-and-productivity.md): keyboard shortcuts
- Code: `features/settings/appearance.ts`, `settingsSchema.ts`, `components/AppearanceSection.tsx`,
  `apps/web/src/index.css`

## The options

| Setting                        | Choices                                                                                 | Default     |
| ------------------------------ | --------------------------------------------------------------------------------------- | ----------- |
| Theme                          | Light, Dark, System (follows your device)                                               | System      |
| Accent colour                  | Violet, Blue, Green, Orange, Pink, Teal                                                 | Violet      |
| Text size                      | Small (14 px), Normal (16 px), Large (18 px), Extra large (20 px). The whole app scales | **Small**   |
| Font                           | **Serif** (Georgia, then Times New Roman), Rounded, System, Mono                        | **Serif**   |
| Density                        | Comfortable, Compact (more chats and messages on screen)                                | Comfortable |
| Message corners                | Rounded, Sharp                                                                          | Rounded     |
| Reduce motion                  | On/off. Also on whenever your device asks for less motion                               | Off         |
| Dyslexia-friendly text         | On/off                                                                                  | Off         |
| High contrast                  | On/off                                                                                  | Off         |
| Chat wallpaper (for all chats) | Any built-in or uploaded wallpaper, or None; plus the dim slider                        | None        |

A preview line ("the quick brown fox...") under the font choice shows the result. The theme, font
size, accent and font are also applied by a tiny script in `index.html` before the first paint, so
there is no flash of the wrong look when the app opens (a test keeps the two in step).

### Fonts

The default font is **Serif**: Georgia, falling back to Times New Roman, then the browser's serif.
Nothing is downloaded; these are fonts already on the device.

| Option          | What it is                                                               |
| --------------- | ------------------------------------------------------------------------ |
| Serif (default) | `Georgia, 'Times New Roman', serif` for the whole app, headings included |
| Rounded         | The app's own look: the system UI font, with no override                 |
| System          | Native system fonts: San Francisco, Segoe UI, Roboto and similar         |
| Mono            | `ui-monospace, SF Mono, Menlo, Consolas, monospace`                      |

### Dyslexia-friendly text

This is a layout aid, not a special downloadable font. It switches to system fonts that are easy to
tell apart (Verdana, then Trebuchet MS, Segoe UI, system UI) and adds wider spacing: letter spacing
0.04em, word spacing 0.12em and line height 1.6. It overrides the Font choice while it is on.

### High contrast

Darker text and stronger borders on the existing colour tokens, in both light and dark themes (black
text on light, white on dark, darker borders). Focus rings become 3 px in the current text colour.

### Wallpapers

47 built-in wallpapers in 7 categories, upload from your gallery (kept on this device), and a dim
slider from 0 to 60 percent. Settings > Appearance > **Chat wallpaper** has the full picker with a live
preview and a None tile, and three buttons: "Use for chats without their own" (the default),
"Apply to every chat" and "Remove wallpaper from all chats" (both ask first and reset the chats' own
wallpapers 3 at a time). Inside a chat, the wallpaper dialog has a "Same as all chats" tile and a line
"All chats default" or "Custom for this chat". The order is: the chat's own wallpaper, then the one for all
chats, then the normal background. The all-chats wallpaper and the dim value are stored on this device only
(not synced), uploaded pictures stay on the device, and the bulk reset covers only chats loaded in the chat
list. Details are in [search and organise](search-and-organise.md). Chat bubbles also keep a safe contrast on
any wallpaper because the slider can darken it.

## Bubble link colours

Links inside message bubbles are always underlined (2 px) and semi-bold so they do not rely on colour
alone.

| Bubble                                     | Link colour                                                                                                                                                                                                                                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sent (your messages, on the accent colour) | Soft sky blue `#d4efff`, underlined. It reads as a link next to white text and keeps 4.5:1 contrast on the bubble. The sent bubble itself is a slightly deeper purple than the plain accent (80 percent accent mixed with dark violet in light theme, 72 percent in dark) so white text reaches 5.4:1 |
| Received, light theme                      | Deep violet `#4b3fc4`, a tint of the accent family, underlined                                                                                                                                                                                                                                        |
| Received, dark theme                       | Light violet `#c4baff`, underlined                                                                                                                                                                                                                                                                    |

Defined in `index.css` (`--bubble-sent-link`, `--bubble-recv-link`).

## Accessibility

| Area               | What Flick does                                                                                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reduce motion      | Animations and transitions shrink to almost nothing and smooth scrolling is turned off. Swipe, sheets and the guide still work without animating. Also follows the device's "reduce motion" request                                                        |
| Keyboard focus     | Every link, button, field and `[tabindex]` element shows a 2 px accent-colour outline with a 2 px offset when focused by keyboard (not when clicked)                                                                                                       |
| Skip link          | "Skip to content" is the first Tab stop                                                                                                                                                                                                                    |
| Dialogs and menus  | Focus moves into the dialog, stays inside it (a focus trap), Escape closes it, and focus returns to where it was                                                                                                                                           |
| Roles and labels   | Chat rows are options in a list box with roving focus (arrow keys, Home, End). Row actions are in a menu with names like "Archive chat with Bob". Tabs, switches, sliders (with spoken values such as "30 percent") and live regions use proper ARIA roles |
| Touch targets      | Buttons and rows are at least 44 px high on phones; text fields are 16 px so iPhone Safari does not zoom                                                                                                                                                   |
| Keyboard shortcuts | Ctrl/Cmd+K palette, `?` cheat sheet, `/`, Alt+N, Alt+Up/Down. See [calendar and productivity](calendar-and-productivity.md)                                                                                                                                |
| Guide              | The tour card is a labelled dialog with live announcements; left/right arrows change step                                                                                                                                                                  |
| Automated checks   | Many screen tests run an axe accessibility check                                                                                                                                                                                                           |

Honest limits: contrast and screen-reader behaviour were checked by tests and review in code, not by a
formal audit with assistive-technology users. Live captions in calls rely on the browser's speech
recognition (see [calls](calls.md)).

## Status

| Item                                                 | Status                 |
| ---------------------------------------------------- | ---------------------- |
| Theme, accent, text size, fonts, density, corners    | Built                  |
| Reduce motion, high contrast, dyslexia-friendly text | Built                  |
| Focus rings, skip link, keyboard use, ARIA           | Built                  |
| Settings synced across devices                       | Not built: per browser |
