# Integrations

Flick can connect to the outside world in five ways: **incoming webhooks** that post text into a chat,
**email to chat** that drops mail into your Saved messages, **passkeys** for sign-in (through Clerk),
**sharing text or links from other apps** into Flick, and **installing Flick** with push notifications
and app shortcuts. None of these use AI, except an optional "Ask Flick" box on the Share screen.
Status: webhooks, passkeys, share target, install and push are Built; email to chat is Partial (works
only when the operator sets it up; the app shows your address in Settings > Account once it is set up).

## Related

- [PWA and push](pwa-and-push.md): install, share target and push in depth
- [Groups](groups.md): group info where webhooks live
- [Settings](settings.md): the Account section with passkeys and devices
- [Notifications](notifications.md)
- [Security: sign-in](../security/auth.md), [deployment](../operations/deployment.md)
- [Platform set-up notes](../platform-setup.md)

## Incoming webhooks

Status: Built. No AI.

A webhook is a secret web address for one chat. Anything that can send an HTTP request (a build
server, a form, a script) can post a line of text into the chat.

**Make one:** open Group info for a group chat. If you are an admin, the **Webhooks** section lets you
add a webhook with a name. The full URL is shown **once** ("Copy this URL now. It will not be shown
again.") with a **Copy URL** button. Each webhook has a **Revoke** button.

**Use it:**

```
POST https://<api>/hooks/<webhook id>/<token>
Content-Type: application/json

{ "text": "Build 142 passed" }
```

| Detail            | Value                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| Body              | `{ "text": "..." }`, 1 to 4000 characters after trimming                                          |
| Result            | 204 No Content. The chat gets a message from the Flick bot: `[Webhook name] text`                 |
| Wrong id or token | 404 "Webhook not found" (the same answer for both, so ids cannot be guessed)                      |
| Rate limit        | 30 requests per minute per IP address                                                             |
| Who can manage    | Any member through the API; the Group info screen shows the section to admins                     |
| Storage           | Only a hash of the token is stored. A lost token cannot be shown again: revoke and make a new one |

Code: `apps/api/src/modules/platform/routes.ts`, `apps/web/src/features/platform/WebhooksSection.tsx`.
Endpoints: `GET/POST /conversations/:id/webhooks`, `DELETE /conversations/:id/webhooks/:webhook_id`,
public `POST /hooks/:id/:token`.

Limits: text only (no files, buttons or formatting rules beyond normal Markdown in the message), and
the webhook section appears only in group info; there is no screen for it in a direct chat.

## Email to chat

Status: Partial.

Mail sent to `<your username>@<domain>` lands in your **Saved messages** as a message starting with
"Email: subject", then the text.

How it works: the operator points an inbound email provider (Postmark Inbound or SendGrid Inbound
Parse) at `POST https://<api>/inbound/email`. The request must carry the secret in an
`x-inbound-secret` header that equals the server setting `INBOUND_EMAIL_SECRET`.

| Detail                  | Value                                                                                                                                                                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Switched on by          | `INBOUND_EMAIL_SECRET` set. If it is empty, the endpoint answers 404                                                                                                                                                                                                                               |
| `INBOUND_EMAIL_DOMAIN`  | The domain shown to users in their forwarding address (`<username>@<domain>`). It is only for display; arriving mail is matched on the part before `@`                                                                                                                                             |
| Your address in the app | Settings > Account > "Email to Saved messages" shows the address with a Copy button (`GET /platform/email-alias`). It is hidden unless both `INBOUND_EMAIL_SECRET` and `INBOUND_EMAIL_DOMAIN` are set, you have a username, and the username uses only letters, digits, dot, underscore and hyphen |
| Fields read             | Postmark `To`, `Subject`, `TextBody`; SendGrid `to`, `subject`, `text`                                                                                                                                                                                                                             |
| Matching                | The part before `@` in the recipient, compared with usernames in lower case                                                                                                                                                                                                                        |
| Result                  | Posted by the Flick bot into that user's Saved messages, cut to 60,000 characters                                                                                                                                                                                                                  |
| Unknown username        | The server still answers 200 so the provider does not retry for ever                                                                                                                                                                                                                               |
| Wrong secret            | 401                                                                                                                                                                                                                                                                                                |
| Rate limit              | 120 requests per minute                                                                                                                                                                                                                                                                            |

**Gaps (honest):** the domain is not checked when mail arrives (only the part before `@`). SendGrid cannot
send custom headers, so it needs a small relay (see [platform-setup](../platform-setup.md)). Only plain text is
used; attachments and HTML are ignored. The address only works if the operator has really pointed a provider at
the endpoint; the app cannot tell whether that is done. A user with no username (username is optional in the
sign-in settings) sees no address.

## Passkeys

Status: Built. Depends on Clerk.

Settings > Account > **Passkeys** lets you **Add a passkey**, rename it and remove it. Passkeys are
created through Clerk's API on your signed-in user (`user.createPasskey`), so they work as a sign-in
method on the Clerk sign-in screen. Passkeys are switched on in the Clerk dashboard now; the section is still
hidden when the browser does not support them. Flick itself stores no
passkey data. Code: `features/platform/PasskeysCard.tsx`, `passkeys.ts`. See
[security: sign-in](../security/auth.md).

## Share to Flick (share target)

Status: Built. Text and links only.

When Flick is installed, it appears in the phone's Share menu. Sharing text or a link opens `/share`
with the title, text and URL joined into one message (duplicates dropped). You pick a chat and tap it
to send. If nothing was shared the page says "Nothing to share".

- **Not supported:** sharing images or files into Flick. The web manifest declares a GET share target
  with `title`, `text` and `url` only.
- AI, optional: when AI is set up, the Share screen has an "Ask Flick" box to ask about the shared text
  before you send it (`AskFlickAboutShared`).

Code: `apps/web/src/pwa/SharePage.tsx`, `shareText.ts`; manifest in `apps/web/vite.config.ts`.

## Install and app shortcuts

Status: Built. No AI.

Flick is a Progressive Web App: name Flick, display standalone, icons 192, 512 and a maskable 512.
An **Install app** button appears in the top bar menu and in Settings when the browser offers it, a card
appears in the chat list (hidden for 14 days after you dismiss it), and an **install guide** shows steps
for iPhone, Android and in-app browsers. Long-pressing the installed icon shows three **shortcuts**:

| Shortcut       | Opens       |
| -------------- | ----------- |
| New chat       | `/people`   |
| Saved messages | `/?saved=1` |
| Calls          | `/calls`    |

Details in [pwa-and-push](pwa-and-push.md).

## Push notifications

Status: Built. Needs the server's push keys. See [pwa-and-push](pwa-and-push.md) and
[notifications](notifications.md).

## Summary

| Integration                         | Status    | Gap                                                                                                          |
| ----------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| Incoming webhooks                   | Built     | Text only; UI in group info only                                                                             |
| Email to chat                       | Partial   | Address is shown in Settings > Account when configured; still needs an inbound email provider and the secret |
| Passkeys                            | Built     | Enabled in Clerk; needs a browser that supports them                                                         |
| Share target                        | Built     | Text and links only, no files                                                                                |
| Install, shortcuts, push            | Built     | iPhone needs the Home Screen app for push                                                                    |
| Outgoing webhooks, public API, bots | Not built |                                                                                                              |
