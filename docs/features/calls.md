# Calls in Flick

Two kinds of calls, built on two different technologies.

|               | 1:1 call                                                                        | Group call                                             |
| ------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Media path    | Phone to phone (WebRTC), through TURN if needed                                 | Everyone sends one stream to a LiveKit server (SFU)    |
| Signaling     | Our Socket.IO events (`call_offer`, `call_answer`, `call_ice`, `call_end`, ...) | LiveKit's own protocol; the API only hands out a token |
| Server needed | coturn (only for hard networks)                                                 | LiveKit                                                |
| Log           | `call_logs` row + a `call_event` message in the chat                            | A "started a group call" `call_event` message          |

## 1:1 calls

Calling someone who is offline or has Flick closed (a push notification with Answer/Decline, and its honest
limits) is in [calls-offline.md](calls-offline.md).

1. The caller makes a `call_id` and sends `call_offer` (with the WebRTC SDP) over Socket.IO.
2. The gateway checks it is a direct chat, nobody is blocked and the callee is online, then relays
   the offer. It keeps "who is calling whom" in Redis, so only the real peer gets later events.
3. The callee answers; both sides trade ICE candidates through the gateway.
4. Audio and video flow directly between the two devices. Our servers never see the media.
5. When the call ends the gateway calls `recordCall(...)` once. It writes the `call_logs` row and a
   `call_event` message ("Missed video call", "Voice call, 2:03") in one transaction. Calling it
   twice with the same `callId` does nothing.

**Why TURN.** Many networks (mobile carriers, strict firewalls) block a direct path. A TURN server
relays the media then. `GET /calls/turn` returns short-lived credentials using coturn's "REST"
scheme: username = `<expiry>:<user id>`, password = base64 HMAC-SHA1 of the username with
`TURN_SECRET`. coturn knows the same secret, so it can check the password without asking us, and
the credential stops working after one hour. Nothing is stored. Without `TURN_SECRET`/`TURN_URLS`
the endpoint returns a public STUN server only.

`GET /calls` is the calls tab: your calls, newest first, keyset-paginated. You see a call only if
you are an active member of its conversation (for a 1:1 call, that is the two people).
`participant_ids` and `conversation_id` give the call-back target.

## Group calls

`POST /calls/livekit-token` with `{ conversation_id }` is for an active member of a group. It
returns a LiveKit URL and a token. The room is `group-<conversation id>`, the identity is the user
id, and the grant is only join, publish and subscribe for that room. The token lasts 10 minutes:
it is only needed to connect. The same transaction writes the "started a group call" message (only
if none was written in the last hour), so the chat never announces a call nobody could join.
Without `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` the endpoint answers
`FEATURE_DISABLED` and names the missing variable.

**Why an SFU and not a mesh.** In a mesh every person sends their video to every other person. With
8 people each phone uploads 7 copies and decodes 7 streams; upload bandwidth and CPU run out at
about 4 to 5 people. With an SFU (selective forwarding unit) each person uploads one stream to the
server, and the server forwards it to the others, choosing a lower quality for slow receivers. The
server does not decode or mix anything, so it stays cheap. The price is running LiveKit.

## Call links

An admin of a group creates a link: `POST /calls/links` with `{ conversation_id, media,
expires_in_s?, max_uses? }`. The response has the `code`, shown once.

- Only a SHA-256 hash of the code is stored (like invite links), so a database leak gives no working
  links. The code is 24 random bytes. Codes never go into logs.
- `GET /calls/links/:code` shows what the link is for, without using it.
- `POST /calls/livekit-token` with `{ call_link: code }` gives a signed-in user a token for the
  room. They do **not** become a conversation member: they cannot read the chat. Each token counts
  as one use, so a person who rejoins uses one more. The use count is bumped by one `UPDATE` with
  the expiry, revoke and max-uses checks in its `WHERE`, so two people cannot take the last use.
- `DELETE /calls/links/:code` revokes it; only the creator can.
- Lookups and redemptions are rate limited per IP.

## Web client

Code: `apps/web/src/features/{calls,groupcall,calllog}`.

### 1:1 calls (`calls/`)

- `useCallStore` is the state machine. Signalling uses the `call_*` events from the contracts
  (`call_offer`, `call_answer`, `call_ice`, `call_end`, `call_reject`, `call_busy`,
  `call_renegotiate`, `call_unavailable`).
- Before each call it asks `GET /calls/turn` for short-lived ICE servers. If that fails, it uses the
  STUN list from config, so a call still starts (it may fail behind strict NATs).
- States: `calling` (ringing out) / `ringing` (incoming) / `connected` with a connection state of
  `connecting` / `connected` / `reconnecting`. A dropped path gets an ICE restart and 15 s to recover.
  A call that cannot start or is lost sets `failure`, which the overlay shows for a few seconds.
- Screen share (video calls, desktop browsers): `getDisplayMedia`, then `replaceTrack` on the video
  sender, so there is no new connection. If the call had no camera, the line is switched to
  send+receive and renegotiated (`call_renegotiate`). The browser's own "Stop sharing" ends the track;
  `track.onended` restores the camera.

### Group calls (`groupcall/`)

- `useGroupCallStore.join({ conversation_id } | { call_link })` calls `POST /calls/livekit-token`,
  then loads `livekit-client` with `import()` (its own chunk, about 570 kB, only fetched on join).
- The store keeps plain tile snapshots (name, speaking, mic, video track); the `Room` stays private.
- Errors become friendly text: 501/503 `FEATURE_DISABLED` ("not set up on this server"), full,
  not allowed, gone.
- "Join call" banner: the server writes a `call_event` with `outcome: 'started'` and `group: true`.
  The banner shows for one hour after the newest one (the server cannot tell when a call ends).
- Call links: admins create/copy/revoke them in the group info panel. `/call/:token` resolves the
  link (`GET /calls/links/:code`) and shows Join. Signed-out visitors see the Clerk sign-in first and
  come back to the same URL.

### Call log (`calllog/`)

`/calls` (Calls in the navbar) lists `GET /calls` with load more. 1:1 rows have a call-back button.

### Config

LiveKit and TURN are configured on the API. The browser can also take `VITE_STUN_URLS` and `VITE_TURN_*` (see [`../operations/deployment.md`](../operations/deployment.md)).

## Interview points

- WebRTC is peer to peer, but it still needs signaling (to swap SDP and ICE) and TURN (for networks
  that block direct paths). STUN only tells a device its public address.
- TURN REST credentials: a shared secret and an expiry in the username give stateless, expiring
  access.
- Mesh grows as N squared in streams; an SFU grows linearly.
- Token authorization: the server decides who may join, and the token limits what they can do.
- The call log and the chat message commit together, and are idempotent on `callId`.
- Known limit: "a call is running" is guessed from the last "started" message (1 hour). Asking
  LiveKit (or using its webhooks) would be exact; we avoided the extra moving part.
