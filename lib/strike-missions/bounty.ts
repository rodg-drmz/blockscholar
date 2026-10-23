import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { MissionError, REWARD, FIELD_NOTE_REWARD, PRACTICE_GRANT, type ClaimKind } from './model';
import { acquireSponsor, dataDir, getRecord, paymentOutboxes, releaseSponsor, reserveClaim, withSponsorLease } from './store';

export const sponsorFile = () => path.join(dataDir(), 'sponsor.preprod.json');
export const MAX_BOUNTY_FEE = 500_000;
export function sponsorWallet() {
  try {
    const file = sponsorFile();
    if ((statSync(file).mode & 0o077) !== 0) throw new Error('permissions');
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (data.network !== 'preprod' || data.purpose !== 'strike-limit-lab-v1' || !/^[a-f0-9]{64}$/.test(data.key)) throw new Error('invalid sponsor');
    const secret = CSL.PrivateKey.from_normal_bytes(Buffer.from(data.key, 'hex'));
    const address = CSL.EnterpriseAddress.new(0, CSL.Credential.from_keyhash(secret.to_public().hash())).to_address();
    return { secret, address };
  } catch { throw new MissionError('This test bounty is awaiting its dedicated Preprod sponsor setup. Your completion remains saved.', 503); }
}
export function sponsorStatus() {
  try { return { configured: true, address: sponsorWallet().address.to_bech32(), network: 'preprod' }; }
  catch { return { configured: false, address: null, network: 'preprod' }; }
}
export async function chain<T>(endpoint: string, init?: RequestInit): Promise<T | null> {
  const key = [process.env.STRIKE_MISSIONS_BLOCKFROST_PREPROD, process.env.BLOCKFROST_API_KEY_PREPROD, process.env.CARDANO_POLLS_BLOCKFROST_PREPROD, process.env.BLOCKFROST_API_KEY_TESTNET].find(v => v?.startsWith('preprod'));
  if (!key) throw new MissionError('The Preprod connection is not configured yet. Your progress is saved.', 503);
  try {
    const r = await fetch(`https://cardano-preprod.blockfrost.io/api/v0${endpoint}`, { ...init, headers: { ...init?.headers, project_id: key }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (r.status === 404) return null;
    if (r.status === 401 || r.status === 403) throw new MissionError('DRMZ’s Cardano Preprod provider key is invalid or no longer authorized. DRMZ must update its Preprod configuration before this step can continue. Your saved progress is unchanged.', 503);
    if (r.status === 402 || r.status === 429) throw new MissionError('The Cardano Preprod provider has reached its request limit. Try again later; your saved progress is unchanged.', 503);
    if (!r.ok) throw new Error('chain unavailable');
    return await r.json();
  } catch (error) {
    if (error instanceof MissionError) throw error;
    const submitting = endpoint === '/tx/submit' && init?.method === 'POST';
    throw new MissionError(submitting
      ? 'Preprod has not acknowledged the saved transaction. Check its receipt again safely; do not create another deposit.'
      : 'DRMZ could not read Cardano Preprod right now. Retry this check; your saved progress is unchanged.', 503);
  }
}
export type Utxo = { tx_hash: string; output_index: number; address?: string; amount: { unit: string; quantity: string }[]; data_hash?: string; inline_datum?: string; reference_script_hash?: string };
/** Read-only, bounded pagination. A failed or partial balance is never displayed as zero. */
export async function readSponsorUtxos() {
  const address = sponsorWallet().address.to_bech32(), utxos: Utxo[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await chain<Utxo[]>(`/addresses/${address}/utxos?count=100&page=${page}&order=asc`);
    if (batch && !Array.isArray(batch)) throw new MissionError('The sponsor balance could not be read.', 503);
    utxos.push(...(batch || []));
    if (!batch || batch.length < 100) return utxos;
  }
  throw new MissionError('The sponsor balance needs a complete network snapshot.', 503);
}
export function summarizeSponsorUtxos(inputs: Utxo[], outboxes: string[]) {
  const spent = new Set<string>();
  for (const hex of outboxes) {
    const ins = CSL.Transaction.from_hex(hex).body().inputs();
    for (let i = 0; i < ins.len(); i++) spent.add(`${ins.get(i).transaction_id().to_hex()}:${ins.get(i).index()}`);
  }
  const lovelace = (u: Utxo) => {
    const amount = u.amount.find(a => a.unit === 'lovelace')?.quantity || '0';
    if (!/^\d+$/.test(amount) || !Number.isSafeInteger(Number(amount))) throw new MissionError('Invalid sponsor balance.', 503);
    return Number(amount);
  };
  let balanceLovelace = 0, spendableLovelace = 0;
  for (const u of inputs) {
    balanceLovelace += lovelace(u);
    if (u.amount.length === 1 && u.amount[0].unit === 'lovelace' && !u.data_hash && !u.inline_datum && !u.reference_script_hash && !spent.has(`${u.tx_hash}:${u.output_index}`)) spendableLovelace += lovelace(u);
  }
  if (!Number.isSafeInteger(balanceLovelace)) throw new MissionError('Invalid sponsor balance.', 503);
  return { balanceLovelace, spendableLovelace };
}
export type Params = { min_fee_a: number; min_fee_b: number; coins_per_utxo_size: string; pool_deposit: string; key_deposit: string; max_val_size: string; max_tx_size: number };
export function buildBounty(address: string, inputs: Utxo[], params: Params, slot: number, wallet = sponsorWallet(), amount: typeof REWARD | typeof FIELD_NOTE_REWARD | typeof PRACTICE_GRANT = REWARD) {
  if (amount !== REWARD && amount !== FIELD_NOTE_REWARD && amount !== PRACTICE_GRANT) throw new MissionError('Unsupported test payment amount.');
  const recipient = CSL.Address.from_bech32(address);
  if (recipient.network_id() !== 0) throw new MissionError('Bounties are test ADA on Preprod only.');
  const n = (v: string | number) => CSL.BigNum.from_str(String(v));
  const config = CSL.TransactionBuilderConfigBuilder.new().fee_algo(CSL.LinearFee.new(n(params.min_fee_a), n(params.min_fee_b)))
    .coins_per_utxo_byte(n(params.coins_per_utxo_size)).pool_deposit(n(params.pool_deposit)).key_deposit(n(params.key_deposit))
    .max_value_size(Number(params.max_val_size)).max_tx_size(params.max_tx_size).do_not_burn_extra_change(true).build();
  const builder = CSL.TransactionBuilder.new(config), candidates = CSL.TransactionUnspentOutputs.new();
  builder.add_output(CSL.TransactionOutput.new(recipient, CSL.Value.new(n(amount))));
  builder.set_ttl_bignum(n(slot + 1800));
  for (const u of inputs) if (u.amount.length === 1 && u.amount[0].unit === 'lovelace' && !u.data_hash && !u.inline_datum && !u.reference_script_hash) {
    candidates.add(CSL.TransactionUnspentOutput.new(CSL.TransactionInput.new(CSL.TransactionHash.from_hex(u.tx_hash), u.output_index), CSL.TransactionOutput.new(wallet.address, CSL.Value.new(n(u.amount[0].quantity)))));
  }
  try {
    builder.add_inputs_from(candidates, CSL.CoinSelectionStrategyCIP2.LargestFirst);
    builder.add_change_if_needed(wallet.address);
    const tx = builder.build_tx(), fee = Number(tx.body().fee().to_str());
    if (fee > MAX_BOUNTY_FEE) throw new Error('fee cap');
    const fixed = CSL.FixedTransaction.from_hex(tx.to_hex());
    fixed.add_vkey_witness(CSL.make_vkey_witness(fixed.transaction_hash(), wallet.secret));
    return { txHash: fixed.transaction_hash().to_hex(), signedTx: fixed.to_hex(), fee, expiresSlot: slot + 1800 };
  } catch { throw new MissionError('The mission sponsor needs more spendable Preprod test ADA to cover the reward, network fee, and required change output. Your completion is saved; no fee was charged.', 503); }
}
export async function claimBounty(actor: string, kind: ClaimKind = 'claim') {
  const amount = kind === 'fieldNoteClaim' ? FIELD_NOTE_REWARD : REWARD;
  const token = acquireSponsor(actor);
  try {
    let r = getRecord(actor);
    if (r[kind]?.status === 'confirmed') return r;
    if (!r.completedAt || !r.rewardAddress) throw new MissionError('Complete the mission and verify your Preprod reward wallet first.');
    if (kind === 'fieldNoteClaim' && (r.claim?.status !== 'confirmed' || !r.blockscholar?.reflection || r.blockscholar.reflection.learning.trim().length < 30 || r.blockscholar.reflection.application.trim().length < 30)) throw new MissionError('Save your field note and confirm the first bounty before claiming 3 test ADA.');
    const wallet = sponsorWallet();
    if (!r[kind]?.signedTx) {
      const [utxos, params, tip] = await Promise.all([
        chain<Utxo[]>(`/addresses/${wallet.address.to_bech32()}/utxos?count=100`),
        chain<Params>('/epochs/latest/parameters'), chain<{ slot: number }>('/blocks/latest'),
      ]);
      if (!params || !tip) throw new MissionError('Waiting for Preprod network information.', 503);
      const spent = new Set<string>();
      for (const hex of paymentOutboxes()) {
        const ins = CSL.Transaction.from_hex(hex).body().inputs();
        for (let i = 0; i < ins.len(); i++) spent.add(`${ins.get(i).transaction_id().to_hex()}:${ins.get(i).index()}`);
      }
      const built = buildBounty(r.rewardAddress, (utxos || []).filter(u => !spent.has(`${u.tx_hash}:${u.output_index}`)), params, tip.slot, wallet, amount);
      // Reserve the campaign cap, then durably persist the exact signed transaction before broadcasting.
      reserveClaim(actor, kind);
      r = withSponsorLease(actor, token, record => {
        if (record.rewardAddress !== r.rewardAddress || record[kind]?.signedTx) throw new MissionError('Your claim changed. Check the saved receipt.', 409);
        record[kind] = { ...record[kind]!, ...built, status: 'submitted' };
      });
    }
    const claim = r[kind]!;
    const [receipt, tip] = await Promise.all([
      chain<{ hash: string; valid_contract: boolean; block_height: number }>(`/txs/${claim.txHash}`),
      chain<{ height: number; slot: number }>('/blocks/latest'),
    ]);
    if (receipt) {
      if (receipt.hash !== claim.txHash || receipt.valid_contract !== true) throw new MissionError('The saved transaction needs operator review.', 503);
      if (tip && tip.height - receipt.block_height >= 1) {
        const io = await chain<{ outputs: { address: string; amount: { unit: string; quantity: string }[] }[] }>(`/txs/${claim.txHash}/utxos`);
        if (!io?.outputs.some(o => o.address === r.rewardAddress && o.amount.some(a => a.unit === 'lovelace' && a.quantity === String(amount)))) throw new MissionError('The payment receipt did not match the expected bounty.', 503);
        return withSponsorLease(actor, token, record => { record[kind]!.status = 'confirmed'; record[kind]!.confirmedAt = Date.now(); });
      }
      return r;
    }
    if (tip && claim.expiresSlot! <= tip.slot) throw new MissionError('The saved payout expired or is still unindexed. Contact DRMZ to reconcile this claim; a second payment will not be created automatically.', 409);
    const submitted = await chain<string>('/tx/submit', { method: 'POST', headers: { 'content-type': 'application/cbor' }, body: new Uint8Array(Buffer.from(claim.signedTx!, 'hex')) });
    if (submitted !== claim.txHash) throw new MissionError('Waiting for the matching payout receipt. Retry Check payment; your transaction is saved.', 503);
    return r;
  } finally { releaseSponsor(token); }
}
