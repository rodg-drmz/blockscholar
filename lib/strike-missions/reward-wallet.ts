import { paymentIdentity } from '../auth/cardano-proof';
import { MissionError, workshopRecord, type MissionRecord } from './model';
import { updateRecord } from './store';

export function linkedRewardAddress(saved: MissionRecord | null): string | null {
  if (!saved) return null;
  const record = workshopRecord(saved);
  if (!record.wallet || !record.walletKey || !record.accountId) return null;
  try {
    const identity = paymentIdentity(record.wallet, 'preprod');
    return identity.ownerKeyHash === record.walletKey ? identity.address : null;
  } catch { return null; }
}

/** Reuse the ownership proof already verified for this authenticated mission. */
export function ensureRewardWallet(actor: string) {
  return updateRecord(actor, (record, bind) => {
    if (record.rewardAddress) return; // Never replace a reviewed destination or receipt.
    if (!record.completedAt) throw new MissionError('Complete the mission before claiming your bounty.');
    if (record.claim) throw new MissionError('Your claim already exists. Check its saved receipt.', 409);
    const address = linkedRewardAddress(record);
    if (!address) throw new MissionError('Verify a Preprod reward wallet before claiming.');
    const identity = paymentIdentity(address, 'preprod');
    bind('reward', identity.ownerKeyHash);
    record.rewardAddress = address;
    record.rewardKey = identity.ownerKeyHash;
  });
}
