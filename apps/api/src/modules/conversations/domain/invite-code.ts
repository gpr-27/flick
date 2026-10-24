import { createHash, randomBytes } from 'node:crypto';

/** 24 random bytes as base64url = 32 characters, which fits the contract's InviteCode. */
export const newInviteCode = () => randomBytes(24).toString('base64url');

/** Only this hash is stored, so a database leak does not leak working links. */
export const hashInviteCode = (code: string) => createHash('sha256').update(code).digest();
