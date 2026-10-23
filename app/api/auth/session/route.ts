import { NextResponse } from 'next/server';
import { readAppSession } from '@/app/api/lib/auth-session';

export const runtime = 'nodejs';

export function GET(req: Request) {
  const session = readAppSession(req);
  const headers = {
    'Cache-Control': 'no-store, private',
    Vary: 'Cookie',
  };
  if (session.kind !== 'verified' && session.kind !== 'legacy') {
    return NextResponse.json(
      { ok: false, authenticated: false },
      { status: 401, headers },
    );
  }
  return NextResponse.json(
    {
      ok: true,
      authenticated: true,
      verified: session.kind === 'verified',
      user: session.user,
      ...(session.kind === 'verified' ? { expiresAt: session.expiresAt } : {}),
    },
    { headers },
  );
}
