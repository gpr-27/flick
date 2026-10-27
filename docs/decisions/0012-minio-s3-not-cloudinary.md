# ADR-0012: S3-compatible media (MinIO locally) with presigned uploads

- **Status:** Accepted (2026-10-24)
- **Related:** ADR-0006, [ADR-0018](0018-any-file-type-1gb-presigned-uploads.md) (any file type, 1 GB, safe serving; this ADR's type check was relaxed there)

## Context

The old app used Cloudinary. We want storage we control, direct uploads and clean-up of abandoned files.

## Decision

- **Storage:** MinIO locally, any S3-compatible store in production, through the AWS SDK v3.
- **Upload:** the client asks for a presigned POST. The server checks the size limit (and, for avatars, the type),
  writes an `attachments` row as `pending` owned by the user, and sets an expiry on the signed POST. After the upload the client confirms,
  the server checks the object size and sniffs the real type, and the row becomes `uploaded`. Sending the message
  checks that the sender owns the upload and marks it `attached`.
- **Download:** a short-lived presigned GET, only after a membership check.
- **Keys:** server-generated and opaque.
- **Checks:** for types the server can verify (images, MP4, WebM, PDF) the real type is sniffed (`file-type`) and must match what was declared; avatars are resized on the server (`sharp`). Other files are accepted as declared and are served as downloads (ADR-0018).
- **Clean-up:** a pg-boss job removes `pending` rows older than 24 hours, and their objects.

## Alternatives

- **Cloudinary:** vendor lock-in.
- **Bytes in Postgres:** bloats backups and WAL.
- **Proxy uploads through the API:** costs API bandwidth and memory.

## Trade-offs

We run MinIO ourselves in development. There is no CDN, and the docs say so.

## Consequences

- Switching provider is a config change (endpoint, region, credentials, bucket).
