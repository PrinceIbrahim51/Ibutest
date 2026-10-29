import { hash, verify } from '@node-rs/argon2';

// OWASP Password Storage Cheat Sheet: Argon2id, m=19 MiB, t=2, p=1 (minimum).
// We use a slightly stronger memory cost.
const OPTIONS = {
  algorithm: 2, // Algorithm.Argon2id (const enum, inlined)
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same amount of time as a real verification. Used when the account does
 * not exist so response timing does not reveal which e-mail addresses are registered.
 */
export async function verifyDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalisation');
  await verifyPassword(await dummyHash, password);
  return false;
}
