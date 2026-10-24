import { S3Client } from '@aws-sdk/client-s3';
import type { Config } from '../../../config.js';

export interface Storage {
  /** Talks to storage from the server (internal address). */
  client: S3Client;
  /** Only signs URLs for browsers, so it uses the public address. It never sends a request. */
  signer: S3Client;
  bucket: string;
}

/** The first required variable that is not set, so a 503 can say what to fix. */
export function missingStorageVariable(config: Config): string | undefined {
  return (['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const).find(
    (name) => !config[name],
  );
}

export function createStorage(config: Config): Storage | undefined {
  if (missingStorageVariable(config)) return undefined;
  const base = {
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID!,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
    },
  };
  return {
    client: new S3Client({ ...base, endpoint: config.S3_ENDPOINT }),
    signer: new S3Client({ ...base, endpoint: config.S3_PUBLIC_ENDPOINT ?? config.S3_ENDPOINT }),
    bucket: config.S3_BUCKET!,
  };
}
