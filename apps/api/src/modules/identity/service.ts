import argon2 from 'argon2';

export const hashPassword = (password: string) => argon2.hash(password, { type: argon2.argon2id });

// Verify against a real hash even when the user does not exist, so response time
// does not reveal which phone numbers are registered.
let dummyHash: Promise<string> | undefined;
export async function verifyPassword(hash: string | undefined, password: string): Promise<boolean> {
  dummyHash ??= hashPassword('not-a-real-password');
  const ok = await argon2.verify(hash ?? (await dummyHash), password);
  return ok && hash !== undefined;
}
