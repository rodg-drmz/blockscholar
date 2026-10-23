import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import { createHash, randomUUID } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519';
import { z } from 'zod';
import { actionSchema, practiceRecord, DEPOSIT_AMOUNT, MissionError, type PracticeDeposit, type MissionRecord } from './model';
import { acquireSetup, getRecord, saveSetup, releaseSetup } from './store';
import { chain, type Utxo } from './bounty';
import { ownedUtxos, requirePracticeWallet, followPayment } from './practice-funding';
import { testnetRequest, tradeClock } from './trading';
import { accountFor, accountFunding } from './strike';

export const depositPaths = {quote: '/v2/deposit/quote', build: '/v2/deposit/build-tx', confirm: '/v2/deposit'} as const;
const decimal = z.string().regex(/^\d+(\.\d+)?$/).max(80);
const lovelace = (u: Utxo) => BigInt(u.amount.find(a=>a.unit==='lovelace')?.quantity || '0');
function assetAmounts(value: CSL.Value) {
  const result=[{unit:'lovelace',quantity:value.coin().to_str()}], policies=value.multiasset()?.keys();
  for(let i=0;i<(policies?.len() || 0);i++) {
    const policy=policies!.get(i), assets=value.multiasset()!.get(policy)!, names=assets.keys();
    for(let j=0;j<names.len();j++) {const name=names.get(j);result.push({unit:policy.to_hex()+Buffer.from(name.name()).toString('hex'),quantity:assets.get(name)!.to_str()});}
  }
  return result;
}
function inputValue(u: Utxo) {
  const value=CSL.Value.new(CSL.BigNum.from_str(lovelace(u).toString())), multi=CSL.MultiAsset.new();
  for(const a of u.amount.filter(a=>a.unit!=='lovelace')) multi.set_asset(CSL.ScriptHash.from_hex(a.unit.slice(0,56)),CSL.AssetName.new(Buffer.from(a.unit.slice(56),'hex')),CSL.BigNum.from_str(a.quantity));
  if(multi.len()) value.set_multiasset(multi);return value;
}
/** The wallet supplies candidates, but Preprod remains authoritative about their value and availability. */
export async function verifiedWalletUtxos(encoded: string[], linked: string): Promise<Utxo[]> {
  const owner=CSL.Address.from_bech32(linked), base=CSL.BaseAddress.from_address(owner);
  const candidates=encoded.map(raw=>{
    try {
      const u=CSL.TransactionUnspentOutput.from_hex(raw), output=u.output(), address=output.address(), candidate=CSL.BaseAddress.from_address(address);
      const sameAccount=address.to_bech32()===linked || !!base && !!candidate && base.stake_cred().to_hex()===candidate.stake_cred().to_hex();
      if(address.network_id()!==0 || !sameAccount || !address.payment_cred()?.to_keyhash() || output.plutus_data() || output.data_hash() || output.script_ref()) throw new Error('unsupported');
      return {tx_hash:u.input().transaction_id().to_hex(),output_index:u.input().index(),address:address.to_bech32(),amount:assetAmounts(output.amount())};
    } catch {throw new MissionError('The selected wallet inputs do not match this Preprod practice account. Reconnect the wallet used for this Strike account.');}
  });
  if(new Set(candidates.map(u=>`${u.tx_hash}:${u.output_index}`)).size!==candidates.length) throw new MissionError('The wallet returned duplicate inputs. Refresh its balance.');
  const addresses=[...new Set(candidates.map(u=>u.address))], live=new Map<string,Utxo[]>();
  for(const address of addresses) {
    const rows:Utxo[]=[];
    for(let page=1;page<=5;page++) {const batch=await chain<Utxo[]>(`/addresses/${address}/utxos?count=100&page=${page}&order=asc`);if(batch && !Array.isArray(batch)) throw new MissionError('Preprod wallet inputs are temporarily unavailable.',503);rows.push(...batch || []);if(!batch || batch.length<100) break;}
    live.set(address,rows);
  }
  const normalized=(amount:Utxo['amount'])=>JSON.stringify(amount.map(a=>[a.unit,BigInt(a.quantity).toString()]).sort((a,b)=>a[0].localeCompare(b[0])));
  return candidates.map(candidate=>{
    const actual=live.get(candidate.address)!.find(u=>u.tx_hash===candidate.tx_hash && u.output_index===candidate.output_index);
    if(!actual || actual.data_hash || actual.inline_datum || actual.reference_script_hash || normalized(actual.amount)!==normalized(candidate.amount)) throw new MissionError('These wallet inputs are unavailable on Cardano Preprod. Check the wallet network and refresh its balance; no deposit was signed.',409);
    return {...actual,address:candidate.address};
  });
}
export function validateQuote(raw: unknown, r: MissionRecord): PracticeDeposit {
  const parsed = z.object({request_id: z.string().min(1).max(200), deposit_address: z.string(), confirmations_required: z.number().int().min(1).max(100), quote: z.object({account_id: z.literal(r.accountId!), request_id: z.string().optional(), blockchain: z.literal('cardano'), asset_symbol: z.literal('ADA'), asset_amount: z.literal(DEPOSIT_AMOUNT), usd_value: decimal, expiration_at: z.number().int().safe()})}).safeParse(raw);
  if (!parsed.success) throw new MissionError('Strike returned a deposit quote that does not match your test account.', 503);
  const q = parsed.data;
  try {
    if (CSL.Address.from_bech32(q.deposit_address).network_id() !== 0 || q.deposit_address === r.wallet || q.quote.expiration_at <= Date.now() + 15_000 || q.quote.expiration_at > Date.now() + 86_400_000 || Number(q.quote.usd_value) <= 0 || q.quote.request_id && q.quote.request_id !== q.request_id) throw new Error('quote');
  } catch { throw new MissionError('The deposit quote has an invalid testnet destination or expiry.', 503); }
  return {requestId: q.request_id, accountId: r.accountId!, address: q.deposit_address, amount: DEPOSIT_AMOUNT, usdValue: q.quote.usd_value, expires: q.quote.expiration_at, confirmations: q.confirmations_required, status: 'quoted'};
}
// The optional authority is supplied ONLY after our server calls the fixed HTTPS
// Strike testnet build endpoint. It is never accepted from a browser action.
// This trusts Strike for route selection, not an independently audited address registry.
export function validateDepositTx(hex: string, d: PracticeDeposit, wallet: string, inputs: Utxo[], slot: number, authority?: 'strike-testnet-api') {
  try {
    if (!/^[a-f0-9]+$/i.test(hex) || hex.length > 32768) throw new Error('CBOR');
    const tx = CSL.FixedTransaction.from_hex(hex), body = tx.body();
    const allowed = new Set(['inputs','outputs','fee','ttl','validity_start_interval','auxiliary_data_hash','network_id','required_signers']);
    for (const [key, value] of Object.entries(body.to_js_value())) if (value !== null && value !== undefined && !allowed.has(key)) throw new Error('unexpected transaction capability');
    const fee = Number(body.fee().to_str()), expiresSlot = Number(body.ttl_bignum()?.to_str());
    if (!tx.is_valid() || fee <= 0 || fee > 500_000 || !Number.isSafeInteger(expiresSlot) || expiresSlot <= slot || expiresSlot > slot + 7200 || body.network_id()?.kind() === 1) throw new Error('fee/network/expiry');
    const credential = CSL.BaseAddress.from_address(CSL.Address.from_bech32(wallet))?.payment_cred() || CSL.EnterpriseAddress.from_address(CSL.Address.from_bech32(wallet))?.payment_cred();
    const signers = body.required_signers();
    const allowedKeys=new Set(inputs.map(u=>CSL.Address.from_bech32(u.address || wallet).payment_cred()?.to_keyhash()?.to_hex()));
    allowedKeys.add(credential?.to_keyhash()?.to_hex());
    for (let i = 0; i < (signers?.len() || 0); i++) if (!allowedKeys.has(signers!.get(i).to_hex())) throw new Error('foreign required signer');
    const ws = tx.witness_set();
    if (ws.native_scripts() || ws.plutus_scripts() || ws.plutus_data() || ws.redeemers() || ws.bootstraps()) throw new Error('unexpected script witness');
    const available = new Map(inputs.map(u => [`${u.tx_hash}:${u.output_index}`, u]));
    const inputKeys=new Set<string>(), tokens=new Map<string,bigint>();
    const addTokens=(amount:Utxo['amount'],sign:bigint)=>{for(const a of amount.filter(a=>a.unit!=='lovelace')) tokens.set(a.unit,(tokens.get(a.unit)||0n)+sign*BigInt(a.quantity));};
    const used = new Set<string>(); let total = 0n, outputs = 0n, deposited = 0n, depositOutputs = 0;
    let paymentAddress = d.address, paymentAmount = d.amount, batcherFee = 0;
    if (!body.inputs().len() || body.inputs().len() > 20) throw new Error('inputs');
    for (let i = 0; i < body.inputs().len(); i++) {
      const input = body.inputs().get(i), id = `${input.transaction_id().to_hex()}:${input.index()}`;
      if (!available.has(id) || used.has(id)) throw new Error('foreign input');
      const u=available.get(id)!;used.add(id);total+=lovelace(u);addTokens(u.amount,1n);
      const key=CSL.Address.from_bech32(u.address || wallet).payment_cred()?.to_keyhash()?.to_hex();if(!key) throw new Error('foreign input');inputKeys.add(key);
    }
    for (let i = 0; i < body.outputs().len(); i++) {
      const output = body.outputs().get(i), address = output.address().to_bech32(), amount = BigInt(output.amount().coin().to_str());
      if (output.address().network_id() !== 0 || output.script_ref()) throw new Error('redirected output');
      if (address === wallet) {
        if (output.data_hash() || output.plutus_data()) throw new Error('locked change');
        addTokens(assetAmounts(output.amount()),-1n);
      } else {
        if(output.amount().multiasset()) throw new Error('redirected output');
        depositOutputs++;
        if (address === d.address && amount === BigInt(DEPOSIT_AMOUNT)) {
          deposited += amount;
        } else {
          if (authority !== 'strike-testnet-api') throw new Error('unverified batcher');
          const datum = output.plutus_data()?.as_constr_plutus_data(), fields = datum?.data();
          if (datum?.alternative().to_str() !== '0' || fields?.len() !== 4 || output.data_hash()) throw new Error('batcher datum');
          const bytesMatch = (i: number, expected: string) => Buffer.from(fields.get(i).as_bytes() || []).toString('hex') === expected;
          const expiry = Number(fields.get(3).as_integer()?.to_str());
          if (!bytesMatch(0, Buffer.from(d.requestId).toString('hex'))
            || !bytesMatch(1, Buffer.from(d.accountId).toString('hex'))
            || !bytesMatch(2, credential!.to_keyhash()!.to_hex())
            || !Number.isSafeInteger(expiry) || expiry <= Date.now() || expiry > Date.now() + 7_200_000
            || amount !== BigInt(DEPOSIT_AMOUNT) + 2_000_000n) throw new Error('batcher datum');
          paymentAddress = address; paymentAmount = amount.toString(); batcherFee = 2_000_000;
          deposited += amount - BigInt(batcherFee);
        }
      }
      outputs += amount;
    }
    if (depositOutputs !== 1 || deposited !== BigInt(DEPOSIT_AMOUNT) || total !== outputs + BigInt(fee) || [...tokens.values()].some(value=>value!==0n)) throw new Error('amount');
    for(let i=0;i<(signers?.len() || 0);i++) inputKeys.add(signers!.get(i).to_hex());
    return {txHash: tx.transaction_hash().to_hex(), fee, expiresSlot, paymentAddress, paymentAmount, batcherFee, inputKeys:[...inputKeys], routeAuthority: authority || 'quoted-vault' as const};
  } catch (error) {
    // Only our fixed validation labels may reach the browser, never raw SDK errors or CBOR.
    const reasons: Record<string, string> = {
      CBOR: 'Strike returned an unreadable transaction',
      'unexpected transaction capability': 'Strike included an unsupported transaction feature',
      'fee/network/expiry': 'The network fee, testnet identifier, or transaction expiry was outside the allowed limits',
      'foreign required signer': 'The transaction requires a different wallet',
      'unexpected script witness': 'The transaction included unexpected scripts',
      inputs: 'The transaction has an unsupported number of inputs',
      'foreign input': 'A transaction input is no longer available in your linked wallet',
      'redirected output': 'An output differs from the quoted Strike vault or your wallet',
      'unverified batcher': 'Strike returned a batching destination different from its quoted vault. DRMZ needs verified routing information before this deposit can be signed',
      'batcher datum': 'Strike’s deposit instructions do not match the request, account, wallet, expiry, or 2-test-ADA batcher fee',
      'locked change': 'The transaction would lock your change',
      amount: 'The deposit amount or transaction balance differs from the reviewed quote',
    };
    const reason = error instanceof Error ? reasons[error.message] : undefined;
    const retry = error instanceof Error && error.message === 'unverified batcher' ? ' Your test funds and saved progress are unchanged.' : ' Refresh the quote and review again.';
    throw new MissionError(`${reason || 'Strike returned an unreadable transaction'}. Nothing was signed.${retry}`, 409);
  }
}
export function addDepositWitness(d: PracticeDeposit, walletKey: string, witnesses: string) {
  try {
    const tx = CSL.FixedTransaction.from_hex(d.unsignedTx!), set = CSL.TransactionWitnessSet.from_hex(witnesses), keys = set.vkeys();
    if (!keys?.len() || keys.len() > 25) throw new Error('signature');
    const required=new Set(d.inputKeys?.length ? d.inputKeys : [walletKey]);
    for (let i = 0; i < keys.len(); i++) {
      const w = keys.get(i), key = w.vkey().public_key();
      if (!key.verify(tx.transaction_hash().to_bytes(), w.signature())) throw new Error('invalid signature');
      required.delete(key.hash().to_hex());
      tx.add_vkey_witness(w);
    }
    if (required.size || tx.transaction_hash().to_hex() !== d.txHash) throw new Error('wallet');
    return tx.to_hex();
  } catch { throw new MissionError('The deposit signature did not match the reviewed transaction and linked wallet.'); }
}
function requestBody(r: MissionRecord, operation: 'quote' | 'build' | 'confirm', utxos?: Utxo[]) {
  const d = r.deposit;
  if (operation === 'quote') {
    if (d && !['quoted','built'].includes(d.status)) throw new MissionError('Check the saved deposit first; another deposit will not be created.', 409);
    return JSON.stringify({blockchain: 'cardano', asset_symbol: 'ADA', asset_amount: DEPOSIT_AMOUNT});
  }
  if (!d) throw new MissionError('Prepare a deposit quote first.');
  if (operation === 'build') {
    if (!['quoted','built'].includes(d.status) || d.expires < Date.now() + 15_000) throw new MissionError('This quote cannot be built. Check the saved deposit or prepare a fresh quote.');
    const selected = (utxos || []).slice(0, 20);
    const total=selected.reduce((sum,u) => sum+lovelace(u),0n);
    if (total < 102_500_000n) throw new MissionError(`The selected Preprod inputs contain ${Number(total)/1e6} test ADA; this deposit needs at least 102.5. This is not your total wallet balance. Refresh the wallet input selection, or use your existing Strike balance.`);
    const encoded = selected.map(u => CSL.TransactionUnspentOutput.new(CSL.TransactionInput.new(CSL.TransactionHash.from_hex(u.tx_hash), u.output_index), CSL.TransactionOutput.new(CSL.Address.from_bech32(u.address || r.wallet!), inputValue(u))).to_hex());
    return JSON.stringify({request_id: d.requestId, user_address: r.wallet, utxos: encoded});
  }
  if (!d.signedTx || !d.txHash || !['submitted','registered'].includes(d.status)) throw new MissionError('Sign and submit the reviewed deposit first.');
  return JSON.stringify({request_id: d.requestId, tx_hash: d.txHash});
}
// Compare decimal credits without floating-point rounding or accepting a balance increase.
function sameDecimal(a: string, b: string) {
  const normalize = (v: string) => { const [whole, fraction = ''] = v.split('.'); return `${BigInt(whole)}.${fraction.replace(/0+$/, '')}`; };
  return normalize(a) === normalize(b);
}
// The batcher's history receipt can reference its next transaction's output,
// rather than the wallet payment. Prove that it spends the exact reviewed output.
async function linkedBatchReceipt(ref: unknown, d: PracticeDeposit) {
  if (d.routeAuthority !== 'strike-testnet-api' || d.batcherFee !== 2_000_000 || !d.unsignedTx || !d.paymentAddress) return false;
  const parsed = typeof ref === 'string' && /^([a-f0-9]{64})#(0|[1-9]\d{0,5})$/.exec(ref);
  if (!parsed) return false;
  const outputs = CSL.FixedTransaction.from_hex(d.unsignedTx).body().outputs();
  let depositIndex = -1;
  for (let i = 0; i < outputs.len(); i++) if (outputs.get(i).address().to_bech32() === d.paymentAddress && outputs.get(i).amount().coin().to_str() === d.paymentAmount) depositIndex = i;
  if (depositIndex < 0) return false;
  const [receipt, tip, io] = await Promise.all([
    chain<{hash: string; valid_contract: boolean; block_height: number}>(`/txs/${parsed[1]}`),
    chain<{height: number}>('/blocks/latest'),
    chain<{inputs: {tx_hash: string; output_index: number; address: string; collateral?: boolean}[]; outputs: {output_index: number; collateral?: boolean}[]}>(`/txs/${parsed[1]}/utxos`),
  ]);
  return !!(receipt?.hash === parsed[1] && receipt.valid_contract === true && Number.isSafeInteger(receipt.block_height)
    && Number.isSafeInteger(tip?.height) && tip!.height - receipt.block_height + 1 >= Math.max(2, d.confirmations)
    && io?.inputs?.some(i => i.tx_hash === d.txHash && i.output_index === depositIndex && i.address === d.paymentAddress && !i.collateral)
    && io?.outputs?.some(o => o.output_index === Number(parsed[2]) && !o.collateral));
}
type DepositProgress = Pick<PracticeDeposit, 'chainConfirmedAt' | 'settlementStatus'>;
export async function checkDeposit(record: MissionRecord, progress?: (value: DepositProgress) => void) {
  const r = practiceRecord(record);
  const d = r.deposit;
  if (!d || !d.signedTx || !d.txHash || !d.expiresSlot || !d.fee || d.status === 'verified') return false;
  if (!await followPayment({status: 'submitted', signedTx: d.signedTx, txHash: d.txHash, expiresSlot: d.expiresSlot, fee: d.fee}, d.paymentAddress || d.address, d.paymentAmount || d.amount, Math.max(2, d.confirmations))) return false;
  progress?.({chainConfirmedAt: d.chainConfirmedAt || Date.now()});
  if (await accountFor(r.wallet!) !== d.accountId) throw new MissionError('The linked Strike account no longer matches the deposit.');
  const query = new URLSearchParams({account_id: d.accountId, type: 'deposit', limit: '100'});
  // Account-scoped, bounded history. No global history or balance-increase inference.
  for (let page = 0; page < 5; page++) {
    const response = await testnetRequest(`/v2/history/transaction?${query}`);
    if (!response.ok || !Array.isArray(response.data.transactions ?? [])) throw new MissionError('Strike’s deposit receipt is not available yet. Check again.', 503);
    const rows = response.data.transactions || [];
    for (const v of rows) {
      const batch = d.routeAuthority === 'strike-testnet-api' && d.batcherFee === 2_000_000;
      const ownerMatches = v.blockchain_address === r.wallet || batch && !!r.walletKey && v.blockchain_address === r.walletKey;
      if (v.request_id !== d.requestId || v.account_id !== d.accountId || v.blockchain !== 'cardano' || !ownerMatches
        || typeof v.amount !== 'string' || !decimal.safeParse(v.amount).success || Number(v.amount) <= 0
        || (batch ? v.asset_symbol !== 'ADA' || String(v.asset_amount) !== d.amount : (v.asset_symbol && v.asset_symbol !== 'ADA') || (v.asset_amount && String(v.asset_amount) !== d.amount))) continue;
      const original = v.tx_hash === d.txHash;
      if (!original && !await linkedBatchReceipt(v.tx_hash, d)) continue;
      // Direct deposits retain exact quoted-credit matching. The official ADA
      // exchanger records execution-priced credit after batching, not a fixed quote.
      if (!batch && !sameDecimal(v.amount, d.usdValue)) continue;
      if (['pending', 'pending_settlement', 'failed', 'cancelled'].includes(v.status)) progress?.({settlementStatus: v.status});
      // Batched ADA is only complete after settlement, never an interim credit.
      if (batch ? v.status === 'settled' : ['completed', 'settled'].includes(v.status)) return {creditedUsd: String(v.amount)};
    }
    if (rows.length < 100) return false;
    const last = rows.at(-1)?.id;
    if (!Number.isSafeInteger(last) || last <= 0) return false;
    query.set('fromId', String(last));
  }
  return false;
}
export async function depositAction(actor: string, a: z.infer<typeof actionSchema>): Promise<{funding?: Awaited<ReturnType<typeof accountFunding>>; notice?: string; depositPlan?: {operation: 'quote'|'build'|'confirm'; body:string; id:string; expires:number; publicKey:string; path:string; serverTime:number}}> {
  const lease = acquireSetup(actor);
  try {
    let r = practiceRecord(getRecord(actor)); const address = requirePracticeWallet(r);
    if (a.type === 'deposit-plan') {
      if (!r.apiPublicKey) throw new MissionError('Reconnect Strike in this tab first.');
      const inputs = a.operation === 'build' ? (a.walletUtxos ? await verifiedWalletUtxos(a.walletUtxos,address) : await ownedUtxos(address)).sort((x,y) => Number(lovelace(y)-lovelace(x))) : undefined;
      const body = requestBody(r, a.operation, inputs), clock = await tradeClock();
      const plan = {operation: a.operation, body, id: randomUUID(), expires: Date.now() + 90_000, publicKey: r.apiPublicKey, ...(a.operation==='build' && a.walletUtxos ? {walletUtxos:a.walletUtxos} : {})};
      saveSetup(actor, lease, latest => { latest.depositRequest = plan; });
      return {depositPlan: {...plan, path: depositPaths[a.operation], serverTime: clock.serverTime}};
    }
    if (a.type === 'deposit-request') {
      const p = r.depositRequest;
      if (!p || p.id !== a.id || p.expires <= Date.now() || p.publicKey !== r.apiPublicKey || a.headers['X-API-Wallet-Public-Key'] !== p.publicKey) throw new MissionError('Deposit authorization expired. Prepare this step again.');
      if (p.operation !== 'quote' && JSON.parse(p.body).request_id !== r.deposit?.requestId) throw new MissionError('The deposit quote changed. Review a fresh transaction.', 409);
      const path = depositPaths[p.operation];
      const msg = `POST:${path}:${a.headers['X-API-Wallet-Timestamp']}:${a.headers['X-API-Wallet-Nonce']}:${createHash('sha256').update(p.body).digest('hex')}`;
      if (Math.abs(Date.now() - Number(a.headers['X-API-Wallet-Timestamp']) * 1000) > 120_000 || !ed25519.verify(Buffer.from(a.headers['X-API-Wallet-Signature'], 'hex'), Buffer.from(msg), Buffer.from(p.publicKey, 'hex'))) throw new MissionError('Deposit signature did not match the prepared request.');
      saveSetup(actor, lease, latest => { delete latest.depositRequest; });
      const response = await testnetRequest(path, {method: 'POST', headers: {...a.headers, 'content-type':'application/json'}, body: p.body});
      if (!response.ok) {
        // Conflict means already submitted, not evidence of credit. Reconcile through history.
        if (p.operation === 'confirm' && response.status === 409) return {notice: 'Strike already has this request. Check its deposit receipt.'};
        throw new MissionError(response.status === 401 ? 'Reconnect Strike, then resume your saved deposit.' : 'Strike could not complete this deposit step. Your saved transaction is preserved; check again.', 503);
      }
      if (p.operation === 'quote') {
        const deposit = validateQuote(response.data, r);
        saveSetup(actor, lease, latest => { if (latest.deposit?.signedTx) throw new MissionError('A signed deposit is already saved.'); latest.deposit = deposit; });
      } else if (p.operation === 'build') {
        const parsed = z.object({blockchain:z.literal('cardano'), format:z.literal('cardano_cbor'), unsigned_tx:z.string().max(32768), expires_at:z.number().int().safe().optional()}).safeParse(response.data);
        if (!parsed.success) throw new MissionError('Strike did not return a Cardano test transaction.', 503);
        const [inputs, tip] = await Promise.all([p.walletUtxos ? verifiedWalletUtxos(p.walletUtxos,address) : ownedUtxos(address), chain<{slot:number}>('/blocks/latest')]);
        if (!tip) throw new MissionError('Waiting for Preprod.', 503);
        const checked = validateDepositTx(parsed.data.unsigned_tx, r.deposit!, address, inputs, tip.slot, 'strike-testnet-api');
        saveSetup(actor, lease, latest => { latest.deposit = {...latest.deposit!, ...checked, unsignedTx: parsed.data.unsigned_tx, expires: Math.min(latest.deposit!.expires, parsed.data.expires_at ?? Infinity), status:'built'}; });
      } else {
        if (response.data.request_id !== r.deposit!.requestId || response.data.tx_hash !== r.deposit!.txHash || response.data.status !== 'pending') throw new MissionError('Strike’s pending receipt does not match your deposit.', 503);
        saveSetup(actor, lease, latest => { latest.deposit!.status = 'registered'; });
      }
      return {};
    }
    if (a.type === 'deposit-submit') {
      const d = r.deposit;
      if (!d || d.txHash !== a.txHash || !d.unsignedTx) throw new MissionError('Review the saved deposit before signing.');
      if (!d.signedTx) {
        if (d.status !== 'built' || d.expires <= Date.now()) throw new MissionError('The unsigned deposit expired. Prepare a fresh quote before signing.');
        const signedTx = addDepositWitness(d, r.walletKey!, a.witnesses);
        r = practiceRecord(saveSetup(actor, lease, latest => { latest.deposit!.signedTx = signedTx; latest.deposit!.status = 'submitted'; }));
      }
      await followPayment({...r.deposit!, status:'submitted', txHash: r.deposit!.txHash!, fee:r.deposit!.fee!, expiresSlot:r.deposit!.expiresSlot!}, d.paymentAddress || d.address, d.paymentAmount || d.amount, Math.max(2, d.confirmations));
      return {};
    }
    if (a.type === 'deposit-check') {
      const result = await checkDeposit(r, progress => { saveSetup(actor, lease, latest => { Object.assign(latest.deposit!, progress); }); });
      if (result) saveSetup(actor, lease, latest => { latest.deposit!.status='verified'; latest.deposit!.verifiedAt=Date.now(); latest.deposit!.creditedUsd=result.creditedUsd; });
      return {funding: await accountFunding(address, r.accountId!)};
    }
    throw new MissionError('Unknown deposit action.');
  } finally { releaseSetup(lease); }
}
