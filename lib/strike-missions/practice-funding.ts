import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { buildBounty, chain, type Utxo, type Params } from './bounty';
import { dataDir, getRecord, acquireSetup, saveSetup, releaseSetup, previousPracticeGrant } from './store';
import { MissionError, PRACTICE_GRANT, practiceRecord, type MissionRecord, type TestPayment } from './model';
import { accountFor } from './strike';

export const practiceSponsorFile = () => path.join(dataDir(), 'practice-sponsor.preprod.json');
export function practiceWallet() {
  try {
    const file = practiceSponsorFile();
    if ((statSync(file).mode & 0o077) !== 0) throw new Error('permissions');
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (data.network !== 'preprod' || data.purpose !== 'blockscholar-practice-v1' || !/^[a-f0-9]{64}$/.test(data.key)) throw new Error('wallet');
    const secret = CSL.PrivateKey.from_normal_bytes(Buffer.from(data.key, 'hex'));
    const address = CSL.EnterpriseAddress.new(0, CSL.Credential.from_keyhash(secret.to_public().hash())).to_address();
    return { secret, address };
  } catch { throw new MissionError('Practice funding is awaiting its separate Preprod sponsor. You can use your own test ADA.', 503); }
}
export function practiceStatus() {
  try { return { configured: true, address: practiceWallet().address.to_bech32(), lovelace: PRACTICE_GRANT }; }
  catch { return { configured: false, address: null, lovelace: PRACTICE_GRANT }; }
}
export function requirePracticeWallet(r: MissionRecord) {
  if (!r.wallet || !r.walletKey || !r.accountId) throw new MissionError('Connect your Strike testnet wallet first.');
  if (CSL.Address.from_bech32(r.wallet).network_id() !== 0) throw new MissionError('This lesson uses Cardano Preprod only. Your linked mainnet wallet cannot receive or deposit test ADA.');
  return r.wallet;
}
export async function ownedUtxos(address: string): Promise<Utxo[]> {
  const rows: Utxo[] = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await chain<Utxo[]>(`/addresses/${address}/utxos?count=100&page=${page}&order=asc`);
    if (batch && !Array.isArray(batch)) throw new MissionError('Preprod returned an incomplete wallet balance.', 503);
    rows.push(...batch || []);
    if (!batch || batch.length < 100) return rows.filter(u => u.amount.length === 1 && u.amount[0].unit === 'lovelace' && !u.data_hash && !u.inline_datum && !u.reference_script_hash);
  }
  throw new MissionError('Use a smaller Preprod practice wallet for this lesson.');
}
/** Replays the exact saved transaction only. Never creates a replacement payment. */
export async function followPayment(payment: TestPayment, address: string, amount: string, confirmations = 2) {
  const [receipt, tip] = await Promise.all([
    chain<{hash: string; valid_contract: boolean; block_height: number}>(`/txs/${payment.txHash}`),
    chain<{height: number; slot: number}>('/blocks/latest'),
  ]);
  if (!tip) throw new MissionError('Waiting for Preprod network information.', 503);
  if (receipt) {
    if (receipt.hash !== payment.txHash || receipt.valid_contract !== true || !Number.isSafeInteger(receipt.block_height) || !Number.isSafeInteger(tip.height)) throw new MissionError('The saved transaction needs operator review.', 409);
    if (tip.height - receipt.block_height + 1 < confirmations) return false;
    const io = await chain<{outputs: {address: string; amount: {unit: string; quantity: string}[]}[]}>(`/txs/${payment.txHash}/utxos`);
    const total = (io?.outputs || []).filter(o => o.address === address).reduce((sum, o) => sum + BigInt(o.amount.find(a => a.unit === 'lovelace')?.quantity || '0'), 0n);
    if (total !== BigInt(amount)) throw new MissionError('The receipt does not match the expected test payment.', 409);
    return true;
  }
  if (payment.expiresSlot <= tip.slot) throw new MissionError('The saved transaction expired or is not indexed. DRMZ must reconcile it before another payment; your record is preserved.', 409);
  if (!payment.signedTx) throw new MissionError('Missing saved transaction. Contact DRMZ.', 409);
  const hash = await chain<string>('/tx/submit', {method: 'POST', headers: {'content-type': 'application/cbor'}, body: new Uint8Array(Buffer.from(payment.signedTx, 'hex'))});
  if (hash !== payment.txHash) throw new MissionError('Waiting for the saved transaction receipt. Check again safely.', 503);
  return false;
}
export async function fundPractice(actor: string, checkOnly: boolean) {
  const lease = acquireSetup(actor, true);
  try {
    let r = practiceRecord(getRecord(actor)); const address = requirePracticeWallet(r);
    if (r.practiceGrant?.status === 'confirmed') return;
    if (!r.practiceGrant) {
      if (checkOnly) return;
      if (previousPracticeGrant(actor,address,r.accountId)) throw new MissionError('This wallet already received its starter grant. Use its existing test funds or restore the previous practice attempt to see the receipt.',409);
      if (await accountFor(address) !== r.accountId) throw new MissionError('Strike account ownership changed. Reconnect first.');
      const wallet = practiceWallet();
      const [inputs, params, tip] = await Promise.all([ownedUtxos(wallet.address.to_bech32()), chain<Params>('/epochs/latest/parameters'), chain<{slot: number}>('/blocks/latest')]);
      if (!params || !tip) throw new MissionError('Waiting for Preprod.', 503);
      const built = buildBounty(address, inputs, params, tip.slot, wallet, PRACTICE_GRANT);
      r = practiceRecord(saveSetup(actor, lease, latest => {
        if (practiceRecord(latest).wallet !== address || latest.practiceGrant) throw new MissionError('Funding record changed. Reload it.', 409);
        latest.practiceGrant = {...built, grantAmount: PRACTICE_GRANT, status: 'submitted'};
      }));
    }
    if (await followPayment(r.practiceGrant!, address, String(r.practiceGrant!.grantAmount ?? 102_000_000))) saveSetup(actor, lease, latest => {
      latest.practiceGrant!.status = 'confirmed'; latest.practiceGrant!.confirmedAt = Date.now();
    });
  } finally { releaseSetup(lease); }
}
