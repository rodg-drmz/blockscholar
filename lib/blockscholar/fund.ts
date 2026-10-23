import { enabled } from '../strike-missions/service';
import { MAX_CLAIMS, REWARD } from '../strike-missions/model';
import { campaignStats, dataDir, paymentOutboxes } from '../strike-missions/store';
import { MAX_BOUNTY_FEE, readSponsorUtxos, sponsorStatus, summarizeSponsorUtxos } from '../strike-missions/bounty';

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
    enabled: true, sponsor: 'DRMZ stake pool', ...sponsor,
    checkedAt: snapshot?.checkedAt || null, balance,
    fundingStatus: !sponsor.configured ? 'not-configured' : !balance ? 'unavailable' : balance.spendableLovelace < REWARD + MAX_BOUNTY_FEE ? 'needs-funding' : 'available',
    rewardLovelace: REWARD, feeAllowanceLovelace: MAX_BOUNTY_FEE, maximumClaims: MAX_CLAIMS, remainingClaims,
    estimatedFundedClaims: balance ? Math.min(remainingClaims, Math.floor(balance.spendableLovelace / (REWARD + MAX_BOUNTY_FEE))) : null,
    paidLovelace: stats.claimsPaid * REWARD,
    pendingLovelace: stats.claimsPending * REWARD,
    verifiedUnpaidLovelace: stats.verifiedUnpaid * REWARD,
    stats,
  };
}
