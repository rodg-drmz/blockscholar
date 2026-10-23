import { NextResponse } from 'next/server';
import { APP_SESSION_COOKIE } from '@/app/api/lib/auth-session';

export const runtime = 'nodejs';

export async function POST() {
  const res = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store, private' } });
  res.cookies.set(APP_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  });
  return res;
}
