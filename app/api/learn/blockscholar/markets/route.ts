import { enabled } from '@/lib/strike-missions/service';
import { strikeMarkets } from '@/lib/blockscholar/markets';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  if (!enabled()) return Response.json({ error: 'This testnet program is not enabled here.' }, { status: 503, headers });
  const snapshot = await strikeMarkets();
  return snapshot ? Response.json({ ...snapshot, network: 'Strike testnet' }, { headers }) : Response.json({ error: 'Strike testnet prices are temporarily unavailable. Your lessons and saved progress remain available.' }, { status: 503, headers });
}
