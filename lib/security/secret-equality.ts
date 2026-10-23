import { timingSafeEqual } from 'node:crypto';

/** Constant-time comparison for server-side bearer secrets and signed tokens. */
export function secretsEqual(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const left = Buffer.from(provided, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
