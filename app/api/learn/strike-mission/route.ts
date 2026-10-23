import { readAppSession } from '@/app/api/lib/auth-session';
import { MissionError } from '@/lib/strike-missions/model';
import { missionAction, status } from '@/lib/strike-missions/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'Vary': 'Cookie' };
export async function GET(request: Request) {
  const s = readAppSession(request);
  try { return Response.json(status(s.kind === 'verified' ? s.user.id : undefined), { headers }); }
  catch { return Response.json({ error: 'Your saved mission is temporarily unavailable.' }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  let origin: URL;
  try {
    origin = new URL(request.headers.get('origin') || '');
    if (!['https:', 'http:'].includes(origin.protocol) || origin.host !== request.headers.get('host')) throw new Error('origin');
  } catch { return Response.json({ error: 'Use the DRMZ mission page.' }, { status: 403, headers }); }
  const s = readAppSession(request);
  if (s.kind !== 'verified') return Response.json({ error: 'Sign in with your DRMZ wallet or email to save this mission.' }, { status: 401, headers });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: 'Expected JSON.' }, { status: 415, headers });
  let body;
  try {
    const reader = request.body?.getReader(); if (!reader) throw new Error('body');
    let size = 0; const chunks: Uint8Array[] = [];
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 24_000) { await reader.cancel(); return Response.json({ error: 'Request too large.' }, { status: 413, headers }); } chunks.push(value); }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return Response.json({ error: 'Invalid mission request.' }, { status: 400, headers }); }
  try { return Response.json(await missionAction(s.user.id, body, origin.origin), { headers }); }
  catch (e) { return Response.json({ error: e instanceof MissionError ? e.message : 'The mission could not update. Your saved progress is unchanged.' }, { status: e instanceof MissionError ? e.status : 503, headers }); }
}
