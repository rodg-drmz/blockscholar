import { dreamFund } from '@/lib/blockscholar/fund';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  try { return Response.json(await dreamFund(), { headers }); }
  catch { return Response.json({ error: 'Fund accounting is temporarily unavailable. Please retry.' }, { status: 503, headers }); }
}
