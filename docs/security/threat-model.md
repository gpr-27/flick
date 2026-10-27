# Flick threat model (short)

This page lists who might attack Flick, what they could try, and what stops them today. It is short on purpose: a
one-page checklist, not a formal analysis. Anything marked "not covered" is a known gap, not a hidden one.

Related: [`auth.md`](auth.md), [`../architecture/overview.md`](../architecture/overview.md),
[`../decisions/0011-e2e-encryption-deferred.md`](../decisions/0011-e2e-encryption-deferred.md),
[`../ai/privacy-and-limits.md`](../ai/privacy-and-limits.md), [`../status.md`](../status.md).

## What we protect

| Asset                                | Why it matters                          |
| ------------------------------------ | --------------------------------------- |
| Messages and files                   | Private conversations                   |
| Accounts and sessions                | Impersonation                           |
| Secrets (Clerk, S3, AI keys, tokens) | Cost, data access                       |
| Availability                         | A chat that is down is useless          |
| AI quota                             | Free-tier keys are shared by every user |

## Who and how

| Threat                                                     | Control                                                                                                                                                                                        | Status / gap                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Someone reads another user's chat through the API          | Membership checked on every read and write; removed members get nothing live and 403 on history                                                                                                | Tested (gate tests)                                        |
| Stolen or forged session token                             | Clerk-signed, about 1 minute lifetime, issued-to-origin check (`authorizedParties`); devices can be revoked                                                                                    | Depends on Clerk                                           |
| Device id of another user                                  | A device id owned by another user answers 403                                                                                                                                                  | Tested                                                     |
| Stored XSS through a message                               | No raw HTML anywhere; safe Markdown renderer; links limited to http, https, mailto; search snippets escaped                                                                                    | Tested                                                     |
| Malicious upload runs as a page                            | Only images (not SVG), audio and video inline; PDF only by `?preview=1` and only when verified; all else forced download                                                                       | Tested                                                     |
| Fake file type                                             | Real type sniffed for images, MP4, WebM, PDF                                                                                                                                                   | Other types accepted as declared (and served as downloads) |
| Malware in a file                                          | Not scanned                                                                                                                                                                                    | **Not covered**                                            |
| SSRF through link preview or AI page reader                | Scheme check, resolve-and-check at connect time, redirect cap, size and time limits                                                                                                            | Tested (package tests)                                     |
| Prompt injection through chat text or files                | Untrusted text is fenced; model output is text only and rendered safely; actions need a click                                                                                                  | Reduces, cannot remove                                     |
| AI cost abuse                                              | Per-user per-minute limit, daily quota (also counts transcribe, translate-batch and auto-transcribe), per-chat switch enforced on style samples, Whisper, translate routes and background jobs | Quota fails open if Redis is down                          |
| Leaked webhook or invite link                              | Tokens stored as hashes (webhook, invite, call link); webhook rate limit; links can be revoked; call links expire                                                                              | Anyone with the link can use it until revoked              |
| Spoofed inbound email                                      | Shared secret header, constant-time check; mail only reaches Saved messages                                                                                                                    | Secret must be kept private                                |
| Brute force and floods                                     | Global per-IP limit, per-socket token bucket, per-route limits; Clerk protects sign-in                                                                                                         | Single-region limits only                                  |
| Wrong Clerk paths send people to a hosted page             | Sign-in `/sign-in`, sign-up `/sign-up`, home `/`, after sign-out `/` set in the Clerk dashboard and in the code                                                                                | Checked at setup                                           |
| Scam and phishing messages from other users                | Local scam, link and impersonation checks (banners), block and report                                                                                                                          | Heuristic, not perfect                                     |
| Operator or database reader reads messages                 | TLS in transit; encrypted disks at the host                                                                                                                                                    | **Not covered**: no end-to-end encryption                  |
| Page asks for camera, microphone or location it should not | `Permissions-Policy` allows them for the app's own origin only                                                                                                                                 | Set in `apps/web/vercel.json`                              |
| Chat lock bypass                                           | Lock is a browser-side convenience                                                                                                                                                             | **Not security**; documented                               |
| Secrets in the repo or logs                                | `.env` ignored; no secret in `render.yaml`; prompts and keys never logged                                                                                                                      | Review before open-sourcing                                |
| `E2E_FAKE_AUTH` left on in production                      | The API refuses to start with it when `NODE_ENV=production`                                                                                                                                    | Enforced                                                   |

## Not in scope

Nation-state attackers, a compromised Clerk or hosting account, physical device theft, and denial of service beyond rate
limits. The free-plan demo has no WAF and no DDoS protection.

## When to revisit

Before adding end-to-end encryption, public sign-up on production Clerk keys, file scanning, or more than one region.
