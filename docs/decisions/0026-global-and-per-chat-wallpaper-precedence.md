# ADR-0026: Global and per-chat wallpaper precedence

- **Status:** Accepted (2026-10-27)
- **Related:** ADR-0022

## Context

People want one wallpaper for every chat, and a different one for some chats. They also want to use their own pictures,
which can be large and private.

## Decision

- **Precedence: per-chat, then global, then default.** A chat shows its own wallpaper if it has one, else the global
  wallpaper, else the normal background. The rule is one small function (`resolveWallpaperId` in
  `features/organise/wallpaperPrecedence.ts`), used by the chat screen, the previews and the labels that say where a
  wallpaper comes from.
- **The per-chat pick is a preference** stored with the chat's own preferences, so it follows the person across devices.
- **The global wallpaper is device-local.** It is part of the appearance settings saved in the browser, so it is not
  synced across devices.
- **Uploaded images stay on the device.** A picture from the gallery is shrunk (longest side 1,600 px, WebP or JPEG),
  stored in IndexedDB on this device, and only its id (`custom:<uuid>`) is saved as the pick. Up to 10 custom wallpapers.
  On another device the picture is missing, so that chat shows the normal background.
- **Readability:** a dim setting (0 to 60 percent) darkens the wallpaper so bubbles stay readable.

## Alternatives

- **Upload wallpapers to the server.** Syncs everywhere but stores private pictures and uses storage for a cosmetic setting.
- **Global overrides per-chat.** Makes a per-chat choice pointless.

## Trade-offs

A custom or global wallpaper does not appear on a second device. This is listed as not built in [`../status.md`](../status.md).

## Consequences

- No server cost for wallpapers.
- Docs: [`../features/appearance-and-accessibility.md`](../features/appearance-and-accessibility.md).
