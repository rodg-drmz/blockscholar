import { createHash } from 'crypto';

const DID_PREFIX = 'drmz-student:';
const WALLET_DID_PREFIX = 'drmz-student-wallet:';

/** Deterministic Veridian-style DID from student email (same email → same DID everywhere). */
export function didFromEmail(email: string): string {
  const normalized = email.toLowerCase().trim();
  const hash = createHash('sha256').update(DID_PREFIX + normalized).digest('hex').slice(0, 32);
  return `did:veridian:${hash}`;
}

/** Stable student DID for an authenticated wallet identity. */
export function didFromWalletIdentity(identityKey: string): string {
  const normalized = identityKey.trim();
  if (!normalized) throw new Error('Wallet identity key is required');
  const hash = createHash('sha256')
    .update(WALLET_DID_PREFIX + normalized)
    .digest('hex')
    .slice(0, 32);
  return `did:veridian:${hash}`;
}

export { truncateDid } from './student-did-display';

export function isStudentDid(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^did:veridian:[a-f0-9]{32}$/.test(value.trim());
}

/** KERI Autonomic Identifier prefix (CESR qb64). */
export function isKeriAid(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^E[A-Za-z0-9_-]{43}$/.test(value.trim());
}
