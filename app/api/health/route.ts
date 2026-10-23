import {appSessionSecretStatus} from '@/app/api/lib/auth-session';
import {sponsorStatus} from '@/lib/strike-missions/bounty';
export const dynamic='force-dynamic';
export function GET(){const ready=appSessionSecretStatus()==='configured';return Response.json({status:ready?'ok':'configuration-required',app:'blockscholar',network:'testnet',walletLogin:ready,emailLogin:!!process.env.RESEND_API_KEY,bounty:sponsorStatus().configured},{status:ready?200:503,headers:{'Cache-Control':'no-store'}});}
