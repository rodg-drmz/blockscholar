import { PracticeError } from '@/lib/spaces/learning-practice.mjs';
import { readAppSession } from '@/app/api/lib/auth-session';
import { readPractice, updatePractice } from '@/lib/spaces/learning-store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(request: Request) {
  const session = readAppSession(request);
  if (session.kind !== 'verified') return Response.json({ error: 'Sign in to save practice to your account.' }, { status: 401, headers });
  try { return Response.json({ state: readPractice(session.user.id), scope: 'account' }, { headers }); }
  catch { return Response.json({ error: 'Your practice record could not be loaded. Try again.' }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  let originOK = false;
  try { const origin = new URL(request.headers.get('origin') || ''); originOK = ['https:', 'http:'].includes(origin.protocol) && origin.host === request.headers.get('host'); } catch { /* Reject missing origins. */ }
  if (!originOK) return Response.json({ error: 'Use the DRMZ learning page.' }, { status: 403, headers });
  const session = readAppSession(request);
  if (session.kind !== 'verified') return Response.json({ error: 'Sign in to save practice to your account.' }, { status: 401, headers });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: 'Expected JSON.' }, { status: 415, headers });
  let action;
  try {
    const reader = request.body?.getReader(); if (!reader) throw new Error('Missing action.');
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 2048) { await reader.cancel(); return Response.json({ error: 'Request too large.' }, { status: 413, headers }); } chunks.push(value); }
    action = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return Response.json({ error: 'Invalid practice action.' }, { status: 400, headers }); }
  try { return Response.json({ ...updatePractice(session.user.id, action), scope: 'account' }, { headers }); }
  catch (error) { return Response.json({ error: error instanceof PracticeError ? error.message : 'Your practice record could not be saved. Try again.' }, { status: error instanceof PracticeError ? 400 : 503, headers }); }
}
