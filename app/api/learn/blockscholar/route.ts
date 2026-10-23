import { readAppSession } from '@/app/api/lib/auth-session';
import { readPractice } from '@/lib/spaces/learning-store';
import { status } from '@/lib/strike-missions/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const session = readAppSession(request), actor = session.kind === 'verified' ? session.user.id : undefined;
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  try {
    const mission = status(actor);
    return Response.json({ mission, viewer: actor || null, practice: mission.enabled && actor ? readPractice(actor) : null }, { headers });
  } catch { return Response.json({ error: 'Your program record could not be loaded. Please retry.' }, { status: 503, headers }); }
}
