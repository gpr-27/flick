# Settings

Settings is one page (`/settings`) with ten sections: Account, Notifications, Appearance, Chats, Calls,
Privacy, Flick assistant, Guide and tips, Storage and data, and Shortcuts and about. On a laptop the
sections list sits on the left and one section shows at a time. On a phone each section opens on its
own. Most settings are kept on your device; privacy and AI choices are kept on the server so they
follow you. The AI section controls the optional AI; nothing else in Settings uses AI.

## Related

- [Notifications](notifications.md), [Appearance and accessibility](appearance-and-accessibility.md),
  [Safety and privacy](safety-and-privacy.md), [Profile](profile.md), [Guide](guide.md)
- [AI privacy and limits](../ai/privacy-and-limits.md), [Flick assistant](../ai/flick-assistant.md),
  [Translation and transcription](../ai/translation-and-transcription.md)
- Code: `apps/web/src/features/settings/` (`SettingsPage.tsx`, `components/`, `settingsSchema.ts`)

## How settings are stored

| Kind            | Where                                                                               | Examples                                                                                 |
| --------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Device settings | `localStorage`, checked against a schema; a damaged value falls back to the default | theme, accent, fonts, sounds, quiet hours, Enter sends, auto-download, app lock PIN hash |
| Server settings | Your account (`/users/me/settings`, `/users/me/privacy`)                            | privacy audiences, read receipts, AI reply language                                      |
| Per-chat prefs  | Your account, per chat                                                              | pin, mute, archive, favourite, wallpaper, lock                                           |

Because device settings are not synced, a new phone starts from the defaults.

## 1. Account

| Item                        | What it does                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edit profile                | Link to [Profile](profile.md)                                                                                                                               |
| Signed-in devices           | Lists your devices; **Sign out** per device and **Sign out of other devices** (`/devices`)                                                                  |
| Alert me about new sign-ins | Note in Saved messages when a new device signs in ([notifications](notifications.md))                                                                       |
| Passkeys                    | Add, rename, remove passkeys using Clerk. Passkeys are enabled in the Clerk dashboard; the card is hidden where the browser does not support them           |
| Email to Saved messages     | Your forwarding address with a Copy button. Shown only when the operator has set up inbound email and you have a username ([integrations](integrations.md)) |
| Your week in Flick          | Messages sent, voice minutes and busiest chats this week (`GET /me/stats`)                                                                                  |
| Download my data            | Saves a JSON export of your data (`GET /users/me/export`)                                                                                                   |
| Delete my account           | Type your username to confirm. Your messages stay in other people's chats as "Deleted user"                                                                 |

## 2. Notifications

Push switch with a test button, notification digest, keyword alerts, priority contacts, briefing and
account quiet hours, message sound, volume (with Test), call ringtone, vibration, message previews,
device quiet hours with From and To, and the browser permission status with a help dialog. All of it is
explained in [notifications](notifications.md). One gap is noted there: keyword alerts work only while the
app is open. (The priority contacts you pick are copied to the server, so they also apply to server quiet hours.)

## 3. Appearance

Theme, accent colour, text size, font, density, message corners, reduce motion, dyslexia-friendly text,
high contrast and the chat wallpaper for all chats (full picker with a None tile and the dim slider, and the
buttons "Use for chats without their own", "Apply to every chat" and "Remove wallpaper from all chats"). The
default font is serif. See [appearance and accessibility](appearance-and-accessibility.md).
On a phone, opening a section shows it as its own page with a "< Settings" header, the bottom tab bar hides, and
the Back button closes the section ([message-gestures.md](message-gestures.md)).

## 4. Chats

| Setting                       | Default | What it does                                                                                                                                                                                       |
| ----------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enter sends                   | On      | On: Enter sends, Shift+Enter adds a line. Off: Enter adds a line, Ctrl/Cmd+Enter sends                                                                                                             |
| Typing indicator              | On      | Show when others type and let them see when you do                                                                                                                                                 |
| Link previews                 | On      | A card for the first link in a message                                                                                                                                                             |
| Media auto-download           | Always  | Always, Wi-Fi only, or Never for photos, videos and voice messages. Otherwise tap to download. "Wi-Fi only" uses the browser's connection information; where the browser cannot tell, it downloads |
| Default disappearing messages | Off     | Off, 24 hours, 7 days or 90 days, for chats you start from now on                                                                                                                                  |
| Keep archived chats archived  | On      | Off: a new message brings an archived chat back                                                                                                                                                    |
| Saved replies                 | none    | Add a shortcut and text; type `/shortcut` in a chat to use it. Kept on this device                                                                                                                 |

## 5. Calls

Camera off by default, Noise suppression (on), Echo cancellation (on), Video quality (Low, Auto, High),
and **Always relay calls** (hides your IP address from the other person, can be a little slower). See
[calls](calls.md).

## 6. Privacy

This section holds three cards: Privacy, App lock and Blocked users. See
[safety and privacy](safety-and-privacy.md) for full detail.

| Item                     | Choices                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Last seen and online     | Everyone or Nobody                                                                                                                          |
| Profile photo            | Everyone or Nobody                                                                                                                          |
| About                    | Everyone or Nobody                                                                                                                          |
| Who can add me to groups | Everyone or Nobody (Nobody: you can still join with an invite link)                                                                         |
| Read receipts            | On/off. Off: you do not send or see read receipts                                                                                           |
| App lock                 | Set a PIN (4 to 8 digits), Lock now, Change PIN, Turn off, and **Require PIN**: only when Flick opens, or after 1, 5, 15 or 60 minutes away |
| Blocked users            | List with Unblock                                                                                                                           |

## 7. Flick assistant (the AI section)

AI: this section controls the optional AI. It works only if AI is set up on the server.

| Item                                  | What it does                                                                                                  | More                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Show the model name                   | A small "Answered by ..." line under every AI answer                                                          | [privacy and limits](../ai/privacy-and-limits.md)                       |
| Check tone before sending             | While you type, Flick can warn that a message may sound harsh and offer a softer one. It never blocks sending | [writing assistant](../ai/writing-assistant.md)                         |
| Preferred reply language              | Flick answers in this language (letters only, up to 40 characters). Empty: the language you write in          | [Flick assistant](../ai/flick-assistant.md)                             |
| Clear my chat with Flick              | Removes the messages for you only                                                                             | [Flick assistant](../ai/flick-assistant.md)                             |
| What Flick remembers                  | Link to `/memory` to view and edit saved memories                                                             | [Flick assistant](../ai/flick-assistant.md)                             |
| Persona                               | How Flick talks to you (default, concise, friendly, formal, tutor) and a language-learning mode               | [writing assistant](../ai/writing-assistant.md)                         |
| AI usage                              | "N of M requests today", resets at midnight UTC                                                               | [privacy and limits](../ai/privacy-and-limits.md)                       |
| AI speed                              | Fast or Quality                                                                                               | [privacy and limits](../ai/privacy-and-limits.md)                       |
| Download my AI data, Clear my AI data | Export or delete what the AI features keep about you                                                          | [privacy and limits](../ai/privacy-and-limits.md)                       |
| Transcribe voice notes automatically  | Voice notes and audio up to 25 MB get a transcript when they arrive, in every chat                            | [translation and transcription](../ai/translation-and-transcription.md) |
| Words to keep untranslated            | A list of names or words that translation must leave alone                                                    | [translation and transcription](../ai/translation-and-transcription.md) |

Where the other AI switches live (they are not in Settings):

- **Ghost text** ("Suggest as I type") and **My voice**: in the settings popover of the writing bar.
- **Follow-up suggestions** under Flick's replies: a switch in the Flick chat tools, off by default
  because each set costs one AI call.
- **Auto-translate** and **per-chat auto-transcribe**: in each chat's menu ("Auto-translate this
  chat", "Auto-transcribe voice notes").
- **AI privacy for one chat**: set inside the chat; see [privacy and limits](../ai/privacy-and-limits.md).

## 8. Guide and tips

Every guide topic by area with a status (New, Seen, Used) and **Show me**; **Take the full tour
again**; the switch **Show tips as I use new features**; and **Reset the guide**. See [guide](guide.md).

## 9. Storage and data

| Item                       | What it does                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Used on this device        | The browser's own estimate of used and available space (or "Your browser does not say")                                                       |
| Media by chat              | How much media each chat holds on the server (`GET /media/usage`), with **Free up space** to clear this device's local cache and cached chats |
| Clear local cache          | Removes saved copies and unsent drafts. Messages waiting to send stay                                                                         |
| Keep drafts on this device | Unsent text survives a reload. Off: drafts live only while the page is open                                                                   |

The auto-download rule is under Chats (above), not here.

## 10. Shortcuts and about

The keyboard shortcut list (laptops only; see [calendar and productivity](calendar-and-productivity.md)),
the app version, a link to the source repository, and **Report a problem**, which files a report against the Flick assistant account
(the same report form used for people and messages).

## Gaps

| Item                                       | Status                                                                     |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| All ten sections                           | Built                                                                      |
| Device settings follow you to a new device | Not built: they are per browser                                            |
| Saved replies sync                         | Not built: per browser                                                     |
| Keyword alerts                             | Partial: only while the app is open, see [notifications](notifications.md) |
