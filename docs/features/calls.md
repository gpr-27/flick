# Calls

Flick has two kinds of calls. A 1:1 voice or video call goes phone to phone over WebRTC (with a TURN relay when a network blocks the direct path), signalled through Flick's own socket. A group call runs through a LiveKit server where everyone sends one stream and the server forwards it. Both have screen sharing and live captions, group calls also have emoji reactions, and every 1:1 call is written to a call log and to the chat. This page describes how calls work, how to use them, the limits, and what is not built. Calling someone whose Flick is closed is in [calls-offline.md](calls-offline.md).

Related: [calls-offline.md](calls-offline.md) | [groups.md](groups.md) | [messaging.md](messaging.md) | [notifications.md](notifications.md) | [pwa-and-push.md](pwa-and-push.md) | [settings.md](settings.md) | [rich-messages.md](rich-messages.md) | [../ai/translation-and-transcription.md](../ai/translation-and-transcription.md) | [../ai/README.md](../ai/README.md) | [../operations/deployment.md](../operations/deployment.md)

Code: `apps/web/src/features/{calls,groupcall,calllog,platform}` (web), `apps/api/src/modules/{calls,gateway}` (API).

## At a glance

|                | 1:1 call                                                                                                                                    | Group call                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Where to start | phone or video button in the chat header, or call back from the Calls page                                                                  | "Start group call" button in a group's header, or "Join call" on the banner |
| Media path     | phone to phone (WebRTC), through TURN if needed                                                                                             | everyone sends one stream to LiveKit                                        |
| Signalling     | Flick socket events `call_offer`, `call_answer`, `call_ice`, `call_end`, `call_reject`, `call_busy`, `call_renegotiate`, `call_unavailable` | LiveKit's own protocol; the API only issues a token                         |
| Server needed  | coturn or a hosted TURN service (only for hard networks)                                                                                    | LiveKit                                                                     |
| Screen share   | yes (video calls, desktop browsers)                                                                                                         | yes                                                                         |
| Reactions      | no                                                                                                                                          | yes (5 emoji)                                                               |
| Live captions  | yes                                                                                                                                         | yes                                                                         |
| Recorded in    | `call_logs` and a call line in the chat                                                                                                     | a "started a group call" line in the chat                                   |

## 1:1 calls

**What it does.** Voice or video call between two people in a direct chat.

**How to use it.**

- Start: the phone button (voice) or video button in the chat header. The first call asks for microphone (and camera) permission.
- Incoming: an "Incoming voice call" or "Incoming video call" card with Accept and Decline, a two-tone ringtone for the callee and a slower ringback tone for the caller. The sounds are made with the Web Audio API (no audio files). A browser only plays sound after you have touched the page once.
- During a call: Mute, camera on/off, share screen, "Fill the screen" or "Show the whole picture", an Audio and video settings panel (pick microphone, camera, and speaker where the browser supports it), live captions, End call.
- Settings, Calls: "Camera off by default", "Noise suppression", "Echo cancellation" and "Video quality" (Low 400 kbps, Auto 1.2 Mbps, High 2.5 Mbps maximum). They are read when a call starts.

**What happens under the hood.**

1. The caller makes a `call_id` and sends `call_offer` with the WebRTC description over Socket.IO.
2. The gateway checks it is a direct chat and nobody is blocked, then relays the offer if the callee is online (it keeps who-calls-whom in Redis, so only the real peer gets later events). If the callee is on another call, the caller gets `call_busy`. If the callee is offline, see [calls-offline.md](calls-offline.md).
3. The callee answers; both sides trade ICE candidates through the gateway. Audio and video then flow directly between the devices. Flick's servers do not see the media.
4. When the call ends, the gateway calls `recordCall` once: it writes the `call_logs` row and a `call_event` chat message ("Missed video call", "Voice call, 2:03") in one transaction, and a second call with the same call id does nothing.

**Timers.** An unanswered outgoing call gives up after 45 seconds. Once answered, the media path has 30 seconds to connect ("Couldn't connect the call. One of your networks may be blocking calls: try Wi-Fi on both phones, or call again."). A dropped path gets an ICE restart and 15 seconds to recover; the failure message stays on screen for 6 seconds.

**TURN.** `GET /calls/turn` returns short-lived ICE servers. With a shared secret (`TURN_SECRET` and `TURN_URLS`) it uses coturn's REST scheme (username `<expiry>:<user id>`, password the base64 HMAC-SHA1 of the username, valid one hour, nothing stored). With a hosted TURN service it hands out the fixed `TURN_USERNAME` and `TURN_CREDENTIAL`. Without any of these it returns a public STUN server only; two phones on different mobile networks may then fail to connect. If the request itself fails, the browser falls back to the configured STUN list.

**Screen sharing.** Video calls, desktop browsers that support `getDisplayMedia`, once connected. The video sender's track is replaced, so there is no new connection; if the call had no camera, the line is renegotiated (`call_renegotiate`). The browser's own "Stop sharing" ends it and the camera comes back.

**Status: Built.**
Gap: 1:1 calls only work between two people in a direct chat (no adding a third person). There is no call recording. An online person whose tab is frozen in the background may not notice a call, because presence, not whether the page is awake, decides if a push is sent.

AI: none on the media itself. Live captions use the browser's speech recognition, and the captions code can translate them with the AI service, but no screen sets a translation language yet.

## Group calls

**What it does.** A call for the members of a group, through LiveKit, with tiles for each person (name, speaking indicator, muted icon).

**How to use it.** In a group, press "Start group call" (users icon) or, when people are already in a call, "Join call" on the banner that reads "A group call is in progress". In the call: Mute, camera, share screen, five reaction buttons (thumbs up, heart, laugh, clap, party), live captions, leave.

**Token.** `POST /calls/livekit-token` with `{conversation_id}` is for an active member of a group. It returns the LiveKit URL and a token for the room `group-<conversation id>` (identity is the user id; join, publish, subscribe and data only). The token lasts 10 minutes (it is needed only to connect). In the same transaction the server writes a "started a group call" chat line, but only if none was written in the last hour. Without `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` the endpoint answers `FEATURE_DISABLED` naming the missing variable, and the app says "Group calls are not set up on this server yet."

**Who is in the call.** LiveKit does not tell Flick, so each participant's browser sends a "still here" beat about every 25 seconds (`POST` group beat) and a "leave" when they go. The entry lives 75 seconds, and a call counts as over when nobody is left. The banner asks `GET` group presence when the chat opens, when a call line arrives, and every 20 seconds.

**Why an SFU.** In a mesh every person sends video to every other person; with 8 people each phone uploads 7 copies, and CPU and upload run out around 4 to 5 people. With an SFU each person uploads one stream and the server forwards it, choosing lower quality for slow receivers. The price is running LiveKit.

**Web client.** `useGroupCallStore.join()` requests the token, then loads `livekit-client` only then (its own chunk, about 570 kB). The store keeps plain tile snapshots; the LiveKit `Room` stays private. Friendly errors: server not set up, call full, not allowed, no longer exists, too many attempts, no connection.

**Status: Built.**
Gap: no cap on participants is set by Flick (limits come from the LiveKit server). No raise-hand, no recording, no per-person volume, and reactions are not stored. "A call is running" comes from presence beats, so a crashed tab can keep the banner up for up to 75 seconds.

## Call links

An admin of a group creates a link to the group's call: `POST /calls/links` with `{conversation_id, media, expires_in_s?, max_uses?}`. The code is shown once.

- The code is 24 random bytes; only a SHA-256 hash is stored, so a database leak gives no working links, and codes are never logged.
- `GET /calls/links/:code` shows what the link is for without using it.
- `POST /calls/livekit-token` with `{call_link}` gives a signed-in user a token. They do not become a group member and cannot read the chat. Each token counts as one use (a person who rejoins uses one more). The use count is increased in one `UPDATE` that also checks expiry, revoke and max uses, so two people cannot take the last use.
- `DELETE /calls/links/:code` revokes it; only the creator can.
- The web page `/call/:token` resolves the link and shows Join; signed-out visitors sign in first and return to the same address. Admins create, copy and revoke links in group info.
- Lookups and redemptions are rate limited (20 per minute) per IP.

**Status: Built.**

## Live captions

**What it does.** Shows what the other side is saying as subtitles.

**How to use it.** The captions button (Captions icon) in the call. Your own microphone is turned into text by the browser's speech recognition (the Web Speech API: Chrome, Edge and Safari, not Firefox); each finished phrase is sent over the call's data channel (an RTCDataChannel in 1:1 calls, LiveKit data in group calls). The other side shows it for about 6 seconds. Nothing goes through Flick's servers. The recognition language is the page language or the browser language.

**Status: Partial.**
Gap: it needs a browser with speech recognition; phrases appear when you finish a sentence, not word by word; browsers usually run speech recognition on their vendor's servers, which is outside Flick's control. The code can translate captions into another language with the AI service, but no screen lets you pick that language yet.

AI: the optional caption translation would use the translation service. See [../ai/translation-and-transcription.md](../ai/translation-and-transcription.md).

## Call log and call back

**What it does.** The Calls page (Calls in the navigation) lists your calls, newest first, with a "load more" control (`GET /calls`, keyset paging). You only see calls from conversations you are an active member of.

**How to use it.**

- Each row shows the name, "Missed video call" / "Voice call", the time, and the duration for completed calls. Missed calls are in red. A group call shows a group icon.
- 1:1 rows have a call-back button (phone or video, matching the call).
- A missed call you made (outgoing) also shows a microphone button to leave a voicemail: a voice note that arrives flagged "Voicemail" in the chat.
- A red number on the Calls link counts missed incoming calls since you last opened the Calls page (the time is remembered on the device).
- The same call also appears as a line in the chat.
- The Calls page also shows the "Allow notifications so you receive calls when Flick is closed" card (see [calls-offline.md](calls-offline.md)).

**Status: Built.**
Gap: no delete or clear of the log, no search or filter, and the missed-call badge counts per device (the "seen" time is in localStorage, not synced). Voicemail is only for missed calls you placed, not a mailbox you can open without a call.

## Config

LiveKit and TURN are configured on the API (`LIVEKIT_*`, `TURN_*`). The browser can also take `VITE_STUN_URLS` and `VITE_TURN_*`. See [../operations/deployment.md](../operations/deployment.md).

## Interview points

- WebRTC is peer to peer, but still needs signalling (to swap descriptions and ICE) and TURN (for networks that block direct paths). STUN only tells a device its public address.
- TURN REST credentials: a shared secret and an expiry in the username give stateless, expiring access.
- A mesh grows as N squared in streams; an SFU grows linearly.
- Token authorisation: the server decides who may join, and the token limits what they can do.
- The call log and the chat line commit together and are idempotent on `callId`.
- LiveKit has no "call ended" signal for us, so the app counts heartbeats instead of guessing from the last "started" message.
