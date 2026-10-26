export interface PasskeyLike {
  id: string;
  name: string | null;
  createdAt: Date | null;
  update: (p: { name: string }) => Promise<unknown>;
  delete: () => Promise<unknown>;
}
export interface ClerkLike {
  user?: {
    passkeys?: PasskeyLike[];
    createPasskey?: () => Promise<unknown>;
    reload?: () => Promise<unknown>;
  } | null;
  __unstable__environment?: { userSettings?: { attributes?: { passkey?: { enabled?: boolean } } } };
}

export const getClerk = (): ClerkLike | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { Clerk?: ClerkLike }).Clerk;

/** True when this browser, this Clerk user and the Clerk dashboard all allow passkeys. */
export const passkeysAvailable = (clerk: ClerkLike | undefined = getClerk()): boolean =>
  !!clerk?.user &&
  typeof clerk.user.createPasskey === 'function' &&
  typeof PublicKeyCredential !== 'undefined' &&
  clerk.__unstable__environment?.userSettings?.attributes?.passkey?.enabled !== false;
