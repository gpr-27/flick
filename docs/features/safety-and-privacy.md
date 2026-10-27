# Safety and privacy

This page covers what you can do to stay safe and private in Flick: block and report people, hide
chats with a lock, protect the app with a PIN, decide who sees your last seen, photo and About, and
the warnings Flick shows for risky links, likely scams and look-alike names. Nearly all of it is plain
code and simple rules. The only optional AI here is a "Check with AI" button on a risky link. Status:
Built, with honest limits described below (the locks are convenience locks, not encryption).

## Related

- [Settings](settings.md): the Privacy section and App lock screen
- [Search and organise](search-and-organise.md): chat lock and the hidden vault in use
- [Groups](groups.md): group safety tools, admins, slow mode
- [Profile](profile.md): the About line and photo that privacy settings control
- [Security: sign-in and sessions](../security/auth.md)
- [AI: productivity and safety](../ai/productivity-and-safety.md), [AI privacy and limits](../ai/privacy-and-limits.md)

## What is and is not AI

| Feature                                                              | Uses AI?                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Block, unblock, report                                               | No                                                                             |
| Privacy settings (last seen, photo, About, group add, read receipts) | No                                                                             |
| Chat lock, hidden vault, app lock                                    | No                                                                             |
| Link warning (before a risky link opens)                             | No. Simple rules on the address text only; nothing is fetched                  |
| **Check with AI** button on the link warning                         | Optional AI. Only when AI is set up and you tap it. Only the link text is sent |
| Scam banner on a first message                                       | No. Word and link scoring rules                                                |
| Look-alike name banner                                               | No. Name comparison rules                                                      |
| Urgent / upset hints on a message                                    | No. Word rules                                                                 |

## Block

Status: Built.

- Block or unblock from a person's contact card in a chat (Block / Unblock button).
- After you block someone, they can no longer send messages in your direct chat: their send is refused
  with "You cannot message this user." Blocking is checked by the server when a message is sent.
- Settings > Privacy > **Blocked users** lists everyone you blocked, with **Unblock**.
- Endpoints: `POST` block, `DELETE` unblock, `GET` list of blocks (the `moderation` group).

## Report

Status: Built.

- **Report** a person from their contact card, or a single message from its menu (Report).
- Pick a reason: **Spam, Harassment, Violence, Sexual content, Scam, Something else**. Add details if
  you like. A tick box **Also block this user** blocks and reports in one step.
- The scam banner (below) has its own **Block and report** button that files a "Scam" report and
  blocks.
- Settings > Shortcuts and about > **Report a problem** uses the same form to report to the Flick
  account (no block option).
- Code: `features/settings/components/ReportDialog.tsx`; endpoint `POST` report (the `moderation` group,
  `apps/api/src/modules/users/http/routes.ts`). A report is stored with the reporter, the reason, details and
  evidence (for a message, its text and time). There is no in-app moderator screen (Not built).

## Privacy settings

Status: Built. Kept on the server, so they apply on all your devices (`/users/me/privacy`).

| Setting                  | Choices          | Effect                                                                |
| ------------------------ | ---------------- | --------------------------------------------------------------------- |
| Last seen and online     | Everyone, Nobody | Who can see when you were last online                                 |
| Profile photo            | Everyone, Nobody | Who can see your photo                                                |
| About                    | Everyone, Nobody | Who can see your About line                                           |
| Who can add me to groups | Everyone, Nobody | Nobody: people cannot add you; you can still join with an invite link |
| Read receipts            | On/off           | Off: you do not send read receipts and you do not see others'         |

Only "Everyone" and "Nobody" exist; there is no "My contacts" choice (Not built).

## Chat lock and hidden vault

Status: Built. This is a convenience lock, not encryption.

- Lock one chat with a passcode (4 or more characters); the chat shows a lock screen until you type it.
- The passcode is hashed in your browser and only the hash is stored. The server does **not** check the
  lock, and the messages remain reachable through the API. Anyone with access to your signed-in
  session can read them. The app says this in the lock dialog.
- Search results from a locked chat stay hidden until you unlock it in this browser tab.
- If you also set an app lock PIN, locked chats move to a **Hidden chats** row (the vault).
- Full detail: [search and organise](search-and-organise.md).

## App lock

Status: Built. A convenience lock, not encryption.

Settings > Privacy > **App lock**:

- **Set a PIN**: 4 to 8 digits, typed twice.
- **Require PIN**: choose **Only when Flick opens**, or after **1, 5, 15 or 60 minutes away**.
- **Lock now**, **Change PIN** (sets a new PIN and timeout; it does not ask for the old one) and **Turn off** (asks for the current PIN).
- The PIN is hashed (PBKDF2-SHA-256, 100,000 rounds, a fixed salt name) and the hash is stored in this
  browser's local storage, not on the server. It keeps someone who picks up your unlocked device from
  reading Flick at a glance. If you clear the browser's storage, the lock is gone; signing out and in
  is the real protection. Code: `features/settings/screenLock.ts`, `components/ScreenLockSettings.tsx`.

## Link safety

Status: Built. No AI by default.

When you tap a link in a message, Flick checks the address text with simple rules before opening it. If
something looks wrong, a dialog shows the link and the reasons. You can **Cancel** or **Open anyway**.
Nothing is fetched or visited to decide.

| Level  | Triggers (examples)                                                                                                                                                                                                                                                                                                                 |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Danger | An `@` in the address that hides the real site; a raw IP address; look-alike (punycode) or unusual characters; a well-known brand name (PayPal, Google, Apple, Microsoft, Amazon, Netflix, Facebook, Instagram, WhatsApp, Binance) on a site that is not the real one; an unencrypted `http` page that asks about login or accounts |
| Warn   | A link shortener (bit.ly, tinyurl.com, t.co and similar); an ending often used for scams (such as .zip, .tk, .top, .xyz, .click); more than four name parts                                                                                                                                                                         |

AI, optional: if AI is set up, the dialog shows **Check with AI**. It sends only the link text and asks
for a short, careful verdict ("looks safe", "suspicious" or "dangerous" and why, never certain). See
[AI: productivity and safety](../ai/productivity-and-safety.md). Code: `features/safety/linkSafety.ts`,
`LinkWarning.tsx`; endpoint `groupTools.linkCheck`.

## Scam banner

Status: Built. No AI.

In a direct chat with a person you have never written to (you have sent no message there), a red
banner "This looks like a scam" appears if one of their text messages scores 3 or more. Points come
from: hurrying you, money or crypto talk, prize promises, "verify your account", asking for a code or
PIN, moving you to another app, easy-money offers, a generic greeting, and suspicious links. The banner
lists the reasons and offers **Block and report** and **Dismiss** (remembered per chat on this device).
Code: `features/safety/scam.ts`, `SafetyBanners.tsx`. These are guesses from words; they can be wrong in
both directions.

## Look-alike name banner

Status: Built. No AI.

In the same kind of chat (a stranger), a yellow banner "Is this really <name>?" appears when the
person's display name copies someone you already chat with: the same after removing accents, spaces and
swapping look-alike characters (0 for o, 1 for l, 3 for e, and so on), or one typo away for names of 6
or more letters. It can be dismissed. Code: `features/safety/impersonation.ts`.

## Other banners in the same strip

For groups, the same strip shows the group's welcome text for new members and, in slow mode, a countdown
before you can send again. See [groups](groups.md).

## Gaps

| Item                               | Status                                                        |
| ---------------------------------- | ------------------------------------------------------------- |
| Block, report, privacy settings    | Built                                                         |
| Chat lock, app lock                | Built; convenience only                                       |
| Link, scam and look-alike warnings | Built; rule based, can be wrong                               |
| "My contacts" privacy audience     | Not built                                                     |
| Moderator review screen            | Not built                                                     |
| End-to-end encryption              | Not built. Messages are stored on the server in readable form |
