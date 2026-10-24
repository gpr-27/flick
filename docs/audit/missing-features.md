# Flick audit: missing features, half-built pieces, phone and accessibility gaps

Read-only audit of `apps/web` (routes, features, components), `packages/contracts/src/rest/endpoints.ts`
and `docs/features/*`. Every item cites a file. Tags: effort S (under a day), M (a few days), L (a week or more).
Value: H (many users notice), M, L.

Routes that exist (`apps/web/src/app/App.tsx`): `/`, `/profile`, `/calls`, `/call/:token`, `/settings`.
Method note: "API without UI" means no `ENDPOINTS.<group>.<name>` reference in `apps/web/src` outside tests.

## Top 15 (prioritized)

1. Group invite links have a full API (create, preview, join, revoke) and no web UI at all. API: `packages/contracts/src/rest/endpoints.ts` (`createInvite`, `previewInvite`, `joinInvite`, `revokeInvite`); UI would go in `apps/web/src/features/chat/components/GroupInfoModal.tsx`. [M, H]
2. Group join requests (`joinRequests`, `decideJoinRequest`) have no admin UI; admins cannot approve anyone. `GroupInfoModal.tsx`. [M, H]
3. No way to edit your own profile (display name, about, photo). `PATCH /users/me` (`users.updateMe`) is never called; `ProfilePage.tsx` is read-only plus Clerk's UserButton. Privacy settings offer an "About" audience for a field the user cannot set. [M, H]
4. Message info ("delivered to / read by") has an API (`messages.info`) and no UI. `MessageMenu.tsx`. [S, M]
5. No user profile view: `users.profile` and `users.directory` are unused, so you cannot tap a name or avatar to see a person, their about, or shared media. `ChatHeader.tsx`, `MessageBubble.tsx`. [M, H]
6. Group avatar and group description are missing. Group info only renames and manages members (`GroupInfoModal.tsx`), although media docs describe a `group_avatar` upload purpose (`docs/features/media.md`). [M, M]
7. Offline notice and update banner ignore the safe area: `top-2` and `bottom-4` with no `env(safe-area-inset-*)`, so the offline pill sits under the notch/status bar on iPhone. `apps/web/src/pwa/PwaBanners.tsx:13,49`. [S, M]
8. Many tap targets under 44px on phones: `btn-sm` (32px) and `btn-xs` (24px) icon buttons in the sidebar header (`Sidebar.tsx:214-247,301`), modal close buttons (`GroupInfoModal.tsx:49`, `NewChatModals.tsx:18`, `StarredPanel.tsx:55`, `ForwardModal.tsx:64`, `ChatLock.tsx:161`), composer clear button `size-6` (`MessageInput.tsx:495`), attach-preview `btn-xs` (`MessageInput.tsx:464`), unblock/Report buttons (`BlockedUsers.tsx:77,86`), call log call-back (`CallLogPage.tsx:67`). Only `ChatHeader.tsx:100,132` and `ChatOptionsMenu.tsx:208` add `min-h-11`. [S, H]
9. `prefers-reduced-motion` is not honored anywhere (no match in `src/` or `index.css`), yet there are animate-bounce incoming-call buttons (`IncomingCallModal.tsx:85`), blobs backgrounds and fade-in-up on every page. [S, M]
10. No "mark as unread", no broadcast lists, no scheduled messages, no chat export, no account deletion (no code or endpoint for any). `useChatStore.ts`, `Sidebar.tsx`, `endpoints.ts`. [M each, M]
11. No light-weight status/stories, no location or contact sharing, no sticker packs (GIF picker only). `MessageInput.tsx`, `GifPicker.tsx`. [L, M]
12. Drag-and-drop and clipboard paste of images/files into the composer are absent (no `onDrop`/`onPaste` anywhere). `MessageInput.tsx`. [S, M]
13. Small low-contrast text: 11px labels at `/60` opacity for timestamps and chat list time (`MessageBubble.tsx:270`, `Sidebar.tsx:79`, `PinnedBar.tsx:33`); 9 uses of `text-base-content/30..50` across components. Likely under WCAG AA 4.5:1 in the pastel themes. [S, M]
14. Message actions chevron is `size-6` (24px) and hidden entirely on touch (`[@media(hover:none)]:hidden`, `MessageBubble.tsx:315`); phones depend on long-press only (`useLongPress.ts`). No visible alternative for users who cannot long-press (switch control, motor impairment, screen readers on touch). [S, H]
15. Settings page has only notifications, privacy, blocked users and install. Missing: theme/chat wallpaper default, font size, media auto-download, language, storage usage, linked devices, active sessions, "about/version". `SettingsPage.tsx`. [M, M]

## 1. Features a WhatsApp-class app has that Flick lacks

- Group invite links UI and join-request approval (see Top 15, items 1 and 2). [M, H]
- Edit own profile: name, about, photo (`ProfilePage.tsx`; `users.updateMe` unused). [M, H]
- Tap-through contact/group profile with shared media, links and docs gallery. `ChatHeader.tsx`. [M, H]
- Message info screen (delivered/read times), API exists. `MessageMenu.tsx`. [S, M]
- Group photo and group description. `GroupInfoModal.tsx`. [M, M]
- Mark chat as unread; clear chat; export chat. `ChatOptionsMenu.tsx`. [S/M, M]
- Status/stories, broadcast lists, scheduled send, location sharing, contact cards, stickers. [L, M]
- Link devices / multi-device session list and sign out of other devices (Clerk only). `SettingsPage.tsx`. [L, M]
- Account deletion and data export (`docs/status.md` mentions an unused `audit_log`; no endpoint). [M, M]
- Privacy options are only Everyone/Nobody; no "My contacts" or per-person exceptions, and no "who can add me to groups", "who can call me", or disappearing-messages default. `PrivacySettings.tsx:15-18`. [M, M]
- End-to-end encryption deferred by design (`docs/decisions/0011-e2e-encryption-deferred.md`); messages are plaintext on the server. [L, H]
- No in-app voice/video quality or device selection (camera/mic picker) in calls. `features/calls/components/CallOverlay.tsx`. [M, L]
- Group call "is it live" is a one-hour guess from the last "started" message, not real state (`docs/features/calls.md`, "Known limit"). Banner can show a dead call. [M, M]
- No picture-in-picture for calls and no call waiting beyond `call_busy`. `useCallStore.ts`. [M, L]
- No message edit history view (edit exists, history of edits not shown). `MessageBubble.tsx`. [S, L]
- No drag-drop/paste attachments, no multi-file send preview with captions per file. `MessageInput.tsx`. [S/M, M]

## 2. Half-built or inconsistent

API without UI (endpoint exists in contracts, never called from the web app):
- `conversations.createInvite/previewInvite/joinInvite/revokeInvite`, `joinRequests`, `decideJoinRequest`. [M, H]
- `users.updateMe`, `users.profile`, `users.directory`. [M, H]
- `messages.info`. [S, M]
- `messages.delivered` / `messages.read` / `messages.send` / `messages.sync` are not called via ENDPOINTS from the web; presumably done over the socket in `features/chat/sync/syncEngine.ts` and `lib/realtime/socketTransport.ts`. Not verified end to end; check that the REST fallbacks are exercised when the socket is down. [S, M]

UI/behaviour without full backing or visible effect:
- Privacy "About" audience controls a field with no editor in the web app. `PrivacySettings.tsx:22`. [S, L]
- "Read receipts" toggle copy says you will not "send or see" receipts; verify the web UI actually hides received ticks when off (`MessageBubble.tsx`, `threadRows.ts`). [S, M]
- `PrivacySettings` only offers Everyone/Nobody although the type is a shared `Audience` that may allow more; no "contacts" option. `PrivacySettings.tsx:12-18`. [S, L]
- Two avatar sources (Clerk picture vs uploaded) and uploaded avatars only show with `S3_PUBLIC_URL` (`docs/status.md`, Known gaps); the web has no avatar upload UI, so the uploaded path is effectively dead from the user's side. `Avatar.tsx`, `ProfilePage.tsx`. [M, M]
- `fakeClerk.tsx` is a dev stand-in for sign-in; make sure it is excluded from production bundles. `features/auth/fakeClerk.tsx`. [S, L]
- Notification settings and sounds (`features/notifications/NotificationSettings.tsx`, `rules.ts`) are per-device local prefs; nothing syncs them to the account, so they differ on each phone. [M, L]
- Ring/DND behaviour: no per-chat call mute; `updatePrefs` only covers mute/archive/pin-style prefs (`ChatOptionsMenu.tsx`). [S, L]
- Disappearing timer is set per chat (`DisappearingMenu.tsx`) with no account default and no indication to the other side besides the setting. [S, L]
- `audit_log` table and `users.is_demo` exist with no writer (`docs/status.md`). [S, L]
- Load tests are "planned" with no scenarios (`docs/status.md:55`). [M, L]

## 3. Phone UX rough edges

- Touch targets under 44px: see Top 15 item 8. Also: `Sidebar.tsx:301` `btn-xs`, `CallOverlay.tsx:244,356` `btn-xs`, `GroupInfoModal.tsx:121` `btn-xs` remove-member, `StarredPanel.tsx:99` `btn-xs`, `ReportDialog.tsx:103,108` `btn-sm`, `SignInPage.tsx:22` `btn-sm`. [S, H]
- Hover-only actions: message actions chevron (`MessageBubble.tsx:315`) is `opacity-0 group-hover:opacity-100` and `hidden` on hover:none. Long-press is the only route on phones; discoverability is poor (no first-use hint). [S, H]
- Several composer buttons are hidden on small screens (`MessageInput.tsx:589,603,612` `max-sm:hidden`; `ChatHeader.tsx:142,155,168,181` `max-sm:hidden`). Confirm each is reachable from another menu on phones (call, search, etc.), otherwise it is a missing feature on mobile. [S, M]
- Safe area is handled for navbar (`Navbar.tsx:55`), composer (`MessageInput.tsx:443`), message menu, call controls, camera. Not handled for: `PwaBanners.tsx:13,49`, `Toast`/`AppToaster` (`components/ui/Toast.tsx`), the generic `Modal` (`components/ui/Modal.tsx:51` centers with no inset padding; tall modals such as `GroupInfoModal.tsx` can reach under the home indicator), `SelfView.tsx` drag bounds. `viewport-fit=cover` is set in `index.html` (checked), so insets work. [S, M]
- Text clipping: 20+ `truncate` usages are fine for names, but the 11px chat-list timestamp is `shrink-0` next to a truncated name (`Sidebar.tsx:79`); long Telugu/Hindi names and "Draft:" prefix (`Sidebar.tsx:99`) can crowd the preview. Untested at 320px width. [S, M]
- No pull-to-refresh and no swipe gestures (swipe to reply, swipe to archive) on touch lists. `Sidebar.tsx`, `VirtualMessageList.tsx`. [M, M]
- Text under 12px at reduced opacity: `text-[11px]` in `MessageBubble.tsx:132,270`, `Sidebar.tsx:79`, `PinnedBar.tsx:33` (8 uses of 9-12px sizes in total). [S, M]
- Settings and profile pages use `pt-24`/`pb-16` fixed spacing (`SettingsPage.tsx`, `ProfilePage.tsx`); the top padding ignores `env(safe-area-inset-top)` on a notched phone, so the heading may tuck under the navbar plus notch. [S, M]
- Theme toggle is hidden on phones in the navbar (`Navbar.tsx:78` `max-sm:hidden`); verify it is in the overflow menu. [S, L]

## 4. Accessibility gaps

- No `prefers-reduced-motion` handling anywhere (Top 15 item 9). [S, M]
- Contrast: translucent `glass` surfaces plus `/60` and lower text opacity; run an automated contrast pass on all three themes (`index.css`). Chat timestamps and meta lines are the likeliest failures. [S, M]
- Touch actions only on long-press (`useLongPress.ts`, `MessageBubble.tsx`): no keyboard or switch-access equivalent to the hidden chevron on touch devices; on desktop the chevron is shown on focus (`focus-visible:opacity-100`), which is good. [S, M]
- Keyboard handling exists in `SelfView.tsx`, `MessageInput.tsx`, `Sidebar.tsx`, `ChatOptionsMenu.tsx`, `PopoverMenu.tsx` only; check message list navigation (arrow keys between messages) and `VirtualMessageList.tsx` focus management when virtualized rows unmount. [M, M]
- Images: caption or "Image" alt (`registry.tsx:85`) only; no alt text editing, and received images with no caption announce just "Image". [S, L]
- Live regions: `aria-live` present in `UserSearch`, `CallOverlay`, `ChatContainer`, `VirtualMessageList`, `GifPicker`; absent for toasts' success states (verify `Toast.tsx`), upload progress, and offline notice (`PwaBanners.tsx`). [S, M]
- Voice note player and waveform (`VoicePlayer.tsx`, `waveform.ts`): confirm a slider/progress role and time text for screen readers. [S, M]
- Poll voting (`PollView.tsx`): confirm radio/checkbox semantics and result announcements. [S, M]
- Skip link and `main` landmark exist (`App.tsx`); there is a single `<html lang="en">` (`index.html:2`) with no per-message `lang` for Telugu/Hindi or translated text (`TranslateDialog.tsx`). [S, L]
- Focus trap exists for modals (`useFocusTrap.ts`); not verified for bottom-sheet menus (`MessageMenu.tsx`) and `AnchoredPanel`. [S, M]
- Pinch zoom is not disabled (no `user-scalable=no` found), good. Nothing to fix. 

## 5. Missing loading, empty and error states

Present (so not gaps): conversation list loading/error/empty (`Sidebar.tsx:325-334`, `SidebarSkeleton.tsx`), thread loading/error (`ChatContainer.tsx:244`, `MessageSkeleton.tsx`), call log (`CallLogPage.tsx:131,142`), starred, search, and full-screen session error (`App.tsx`).

Gaps:
- Settings: `PrivacySettings.tsx` shows a bare "Loading..." text and an error with no retry button; `BlockedUsers.tsx` and `NotificationSettings.tsx` need the same check (no `ErrorState`/`Spinner` use). [S, M]
- `ProfilePage.tsx` returns `null` if the session user is missing: a blank page instead of a loader or error. [S, M]
- `CallLinkPage.tsx`: verify distinct states for expired, revoked, full and signed-out links (docs list friendly errors for the store; confirm the page shows them). [S, M]
- `GifPicker.tsx`: has `gifErrors.ts`; confirm an empty-results state and a "GIPHY not configured" (503) state that hides the button instead of failing on tap. [S, M]
- `GroupInfoModal.tsx`: member list load has no skeleton or error/retry shown (uses `loadMembers` from the store). [S, M]
- `LinkPreviewCard.tsx`: failed previews fall back silently; fine, but no loading placeholder, causing layout shift in the message list. [S, L]
- Media bubbles: image error state exists (`registry.tsx:99`); video, audio and file attachments need the same expired-URL (5 minute signed link, `docs/features/media.md`) recovery, i.e. refresh the URL on error. `MediaViews.tsx`, `VoicePlayer.tsx`. [M, H]
- Starred, pinned and search panels have errors; none have a retry on partial pagination failure (`StarredPanel.tsx:99,122` load-more). [S, L]
- Upload failure and cancel paths in the composer (`upload.ts`, `MessageInput.tsx`): check progress, cancel, retry on 413/415 with friendly text. [S, M]
- AI panel (`FlickPanel.tsx`, `SuggestReplies.tsx`): 503 "not configured" is handled in `aiApi.ts` (`isNotConfigured`); confirm every entry point hides itself when `/ai/status` says disabled. [S, L]

## Not verified / limits of this audit

Nothing was run: no screenshots, no device testing, no contrast measurement. Statements marked "verify" or "confirm" are
places where static reading was not enough. Touch target sizes assume daisyUI defaults (btn-sm 32px, btn-xs 24px).
