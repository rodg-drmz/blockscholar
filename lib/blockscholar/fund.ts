import { enabled } from '../strike-missions/service';
import { MAX_CLAIMS, REWARD, FIELD_NOTE_REWARD } from '../strike-missions/model';
import { campaignStats, dataDir, paymentOutboxes } from '../strike-missions/store';
import { MAX_BOUNTY_FEE, readSponsorUtxos, sponsorStatus, summarizeSponsorUtxos } from '../strike-missions/bounty';

// Conservative reserve for the sponsor’s ADA-only change output; claims still build against live parameters.
const CHANGE_RESERVE = 1_000_000;
type Snapshot = { checkedAt: number; utxos: Awaited<ReturnType<typeof readSponsorUtxos>> };
// Deduplicate requests within a server instance; no secrets or actor data are cached.
let cached: { directory: string; expires: number; promise: Promise<Snapshot | null> } | undefined;
export function resetFundCache() { cached = undefined; }
export async function dreamFund() {
  if (!enabled()) return { enabled: false };
  const sponsor = sponsorStatus(), stats = campaignStats(), directory = dataDir();
  if (sponsor.configured && (!cached || cached.directory !== directory || cached.expires < Date.now())) {
    cached = { directory, expires: Date.now() + 45_000, promise: readSponsorUtxos().then(utxos => ({ utxos, checkedAt: Date.now() })).catch(() => null) };
  }
  const snapshot = sponsor.configured ? await cached!.promise : null;
  const remainingClaims = Math.max(0, MAX_CLAIMS - stats.claimsStarted);
  const balance = snapshot ? summarizeSponsorUtxos(snapshot.utxos, paymentOutboxes()) : null;
  return {
    enabled: true, sponsor: 'DRMZ Web3', ...sponsor,
    checkedAt: snapshot?.checkedAt || null, balance,
    fundingStatus: !sponsor.configured ? 'not-configured' : !balance ? 'unavailable' : balance.spendableLovelace < REWARD + FIELD_NOTE_REWARD + 2 * MAX_BOUNTY_FEE + CHANGE_RESERVE ? 'needs-funding' : 'available',
    rewardLovelace: REWARD, fieldNoteRewardLovelace: FIELD_NOTE_REWARD, programRewardLovelace: REWARD + FIELD_NOTE_REWARD, feeAllowanceLovelace: MAX_BOUNTY_FEE, changeReserveLovelace: CHANGE_RESERVE, maximumClaims: MAX_CLAIMS, remainingClaims,
    estimatedFundedClaims: balance ? Math.min(remainingClaims, Math.max(0, Math.floor((balance.spendableLovelace - CHANGE_RESERVE) / (REWARD + FIELD_NOTE_REWARD + 2 * MAX_BOUNTY_FEE)))) : null,
    paidLovelace: stats.claimsPaid * REWARD + stats.fieldNoteClaimsPaid * FIELD_NOTE_REWARD,
    pendingLovelace: stats.claimsPending * REWARD + stats.fieldNoteClaimsPending * FIELD_NOTE_REWARD,
    verifiedUnpaidLovelace: stats.verifiedUnpaid * REWARD + stats.fieldNoteUnpaid * FIELD_NOTE_REWARD,
    stats,
  };
}
