# Platform features: external setup

- **Passkeys**: Clerk dashboard > User & authentication > Passkeys > enable. Until then the Passkeys section in Settings > Account stays hidden.
- **Email-to-chat**: set `INBOUND_EMAIL_SECRET` (and `INBOUND_EMAIL_DOMAIN`, shown to users) in the API env. In Postmark (Inbound stream) or SendGrid (Inbound Parse), point the webhook at `POST https://<api>/inbound/email` and send the secret in the `x-inbound-secret` header (Postmark: add it to the webhook URL's custom headers via a proxy, or use Basic auth + a small relay; SendGrid cannot set headers, so use a relay). Mail to `<username>@<INBOUND_EMAIL_DOMAIN>` lands in that user's Saved messages. Off when the secret is unset.
- **Webhooks**: Group info > Webhooks > Create. The URL `POST <api>/hooks/<id>/<token>` with `{"text": "..."}` posts as the Flick bot (30 requests per minute per IP). The token is shown once.
- **Notification Reply box**: Chrome/Edge desktop only. The typed text opens the chat as a draft (no server-side send from the worker).
- **Live captions**: Chrome, Edge, Safari (Web Speech API). Not Firefox.
