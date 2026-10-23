/** Display helper — safe for client components (no Node crypto). */
export function truncateDid(did: string): string {
  const trimmed = did.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 22) return trimmed;
  if (trimmed.startsWith('did:veridian:')) {
    const suffix = trimmed.slice('did:veridian:'.length);
    if (suffix.length <= 12) return trimmed;
    return `did:veridian:…${suffix.slice(-8)}`;
  }
  return `${trimmed.slice(0, 12)}…${trimmed.slice(-6)}`;
}
