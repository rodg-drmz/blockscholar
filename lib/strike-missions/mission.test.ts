import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import * as CMS from '@emurgo/cardano-message-signing-nodejs';
import { MISSION, publicQuestions, type MissionRecord } from './model';
import { validateOrder, orderFor } from './strike';
import { missionAction, status, testnetApp } from './service';
import { acquireSponsor, getRecord, releaseSponsor, reserveClaim, updateRecord, switchPracticeAttempt, practiceHistory, previousPracticeGrant, campaignStats, acquireSetup, releaseSetup } from './store';
import { buildBounty, claimBounty, sponsorFile } from './bounty';
import { GET, POST } from '../../app/api/learn/strike-mission/route';
import { buildUser, createAppSessionToken } from '../../app/api/lib/auth-session';
import { newStrikeSession, signTestOrder, connectionAddress, walletRequest, inspectWalletAccount, assertWalletAccount } from '../../packages/spaces-studio/src/strike-session.mjs';
import { builderFailure, planOrder } from './trading';

const account = '019a0c2e-1111-7000-8000-000000000001';
const now = Date.now();
const open = { ID: '12345', AccountID: account, Symbol: 'ETH-USD', Status: 'open', Side: 'buy', Type: 'limit', Size: '0.02', Price: '2300', Filled: '0', CreateTimestamp: now, EventTimestamp: now };
const params = { min_fee_a: 44, min_fee_b: 155381, coins_per_utxo_size: '4310', pool_deposit: '500000000', key_deposit: '2000000', max_val_size: '5000', max_tx_size: 16384 };
const wallet = () => { const secret = CSL.PrivateKey.generate_ed25519(); return { secret, address: CSL.EnterpriseAddress.new(0, CSL.Credential.from_keyhash(secret.to_public().hash())).to_address() }; };
test('reconnect signs the saved identity even when a wallet rotates its change address',async()=>{
  const old=wallet().address.to_bech32(), changed=wallet().address.to_hex(), practice=wallet().address.to_bech32();let reads=0;
  const api={getChangeAddress:async()=>{reads++;return changed;}};
  assert.equal(await connectionAddress(api,'builder',{wallet:old}),old);
  assert.equal(await connectionAddress(api,'practice',{wallet:old,practiceConnection:{wallet:practice}}),practice);
  assert.equal(await connectionAddress(api,'practice',{wallet:old}),old);
  assert.equal(reads,0);
  assert.equal(await connectionAddress(api,'builder',{}),changed);
  assert.equal(await connectionAddress(api,'reward',{}),changed);
  assert.equal(reads,2);
});

test('wallet connector identifies CIP-30 errors without exposing arbitrary wallet payloads',async()=>{
  for(const [step,code,message] of [['sign',2,/cannot sign/],['sign',1,/generate/],['sign',3,/signature rejection \(code 3\)/],['sign',-3,/refused access.*code -3/],['enable',-3,/refused access/],['network',-4,/account changed/]] as const) {
    await assert.rejects(walletRequest(step,()=>Promise.reject({code,info:'private upstream data'})),message);
  }
  await assert.rejects(walletRequest('sign',()=>Promise.reject(null)),/message approval failed/);
  await assert.rejects(walletRequest('address',()=>{throw new Error('private upstream data');}),/address lookup failed/);
  assert.equal(await walletRequest('network',async()=>0),0);
});
test('read-only wallet diagnostics distinguish rotated addresses from a different staking identity',async()=>{
  const payment=wallet().secret.to_public().hash(), other=wallet().secret.to_public().hash(), stake=wallet().secret.to_public().hash();
  const address=(pay:typeof payment, staking:typeof stake)=>CSL.BaseAddress.new(0,CSL.Credential.from_keyhash(pay),CSL.Credential.from_keyhash(staking)).to_address();
  const saved=address(payment,stake), rotated=address(other,stake);
  const api={getChangeAddress:async()=>rotated.to_hex(),getUsedAddresses:async()=>[saved.to_hex()],getUnusedAddresses:async()=>[],getRewardAddresses:async()=>[]};
  const match=await inspectWalletAccount(api,saved.to_bech32());
  assert.deepEqual(match,{currentAddress:rotated.to_bech32(),savedAddressListed:true,sameStakeKey:true,currentAddressMatches:false,unavailableReads:0});
  assert.doesNotThrow(()=>assertWalletAccount(match,saved.to_bech32()));
  const wrong=await inspectWalletAccount({...api,getUsedAddresses:async()=>[],getChangeAddress:async()=>address(other,other).to_hex()},saved.to_bech32());
  assert.equal(wrong.sameStakeKey,false);assert.equal(wrong.savedAddressListed,false);
  assert.throws(()=>assertWalletAccount(wrong,saved.to_bech32()),/No signature was requested/);
  const unavailable=await inspectWalletAccount({},saved.to_bech32());
  assert.equal(unavailable.sameStakeKey,null);assert.equal(unavailable.currentAddressMatches,null);assert.equal(unavailable.unavailableReads,4);
  assert.doesNotThrow(()=>assertWalletAccount(unavailable,saved.to_bech32()));
});
test('wallet approval times out without accepting a late signature or retrying it',async()=>{
  let calls=0,finish: (value: unknown) => void = () => { throw new Error('Operation did not start'); };const operation=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
  await assert.rejects(walletRequest('sign',operation,5),/message approval timed out/);
  finish({key:'late',signature:'ignored'});await Promise.resolve();assert.equal(calls,1);
});

function signature(w: ReturnType<typeof wallet>, hex: string) {
  const headers = CMS.HeaderMap.new(); headers.set_algorithm_id(CMS.Label.from_algorithm_id(CMS.AlgorithmId.EdDSA));
  headers.set_header(CMS.Label.new_text('address'), CMS.CBORValue.new_bytes(w.address.to_bytes()));
  const builder = CMS.COSESign1Builder.new(CMS.Headers.new(CMS.ProtectedHeaderMap.new(headers), CMS.HeaderMap.new()), Buffer.from(hex, 'hex'), false);
  const signed = builder.build(w.secret.sign(builder.make_data_to_sign().to_bytes()).to_bytes());
  const key = CMS.COSEKey.new(CMS.Label.new_int(CMS.Int.new_i32(1))); key.set_algorithm_id(CMS.Label.from_algorithm_id(CMS.AlgorithmId.EdDSA));
  key.set_header(CMS.Label.new_int(CMS.Int.new_i32(-1)), CMS.CBORValue.new_int(CMS.Int.new_i32(6)));
  key.set_header(CMS.Label.new_int(CMS.Int.new_i32(-2)), CMS.CBORValue.new_bytes(w.secret.to_public().as_bytes()));
  return { key: Buffer.from(key.to_bytes()).toString('hex'), signature: Buffer.from(signed.to_bytes()).toString('hex') };
}
function setup(t: test.TestContext) {
  const env = { ...process.env }, fetch = global.fetch, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strike-mission-test-'));
  process.env.STRIKE_MISSIONS_DATA_DIR = dir; process.env.STRIKE_MISSIONS_ENABLED = 'true';
  process.env.STRIKE_MISSIONS_BLOCKFROST_PREPROD = 'preprod-fixture-no-live-requests';
  process.env.DRMZ_APP_SESSION_SECRET = 'strike-tests-only-session-secret-longer-than-32';
  t.after(() => { process.env = env; global.fetch = fetch; fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}
test('fresh practice archives wallet evidence while preserving lessons and restores without stale authorization',async t=>{
  setup(t);const actor='restart-owner',old=wallet().address.to_bech32();
  updateRecord(actor,r=>{
    r.wallet=old;r.walletKey='private-key-hash-fixture';r.accountId=account;r.apiPublicKey='old-api';r.lessonAt=now;
    r.blockscholar={enrolledAt:now,reflection:{learning:'saved learning',application:'saved application',artifactUrl:'',savedAt:now}};
    r.trade={clientId:'draft-only',body:'draft',price:'2300',size:'0.005',status:'draft'};
    r.builderChallenge={nonce:'secret-nonce',message:'private-challenge',publicKey:'old-api',address:old,key:'old-key',network:'preprod',expires:now+10000,origin:'http://localhost:3000'};
  });
  const before=getRecord(actor);
  const fresh=await missionAction(actor,{type:'practice-restart',expectedUpdatedAt:before.updatedAt},'http://localhost:3000');
  const next=getRecord(actor);assert.equal(next.wallet,undefined);assert.equal(next.trade,undefined);assert.equal(next.apiPublicKey,undefined);
  assert.equal(next.lessonAt,now);assert.deepEqual(next.blockscholar,before.blockscholar);
  assert.doesNotMatch(JSON.stringify(fresh),/private-key-hash-fixture|old-api|secret-nonce|private-challenge/);
  assert.throws(()=>switchPracticeAttempt(actor,before.updatedAt),/another tab/);
  const [saved]=practiceHistory(actor);assert.equal(saved.wallet,old);
  updateRecord('different-owner',r=>{r.lessonAt=now;});
  assert.throws(()=>switchPracticeAttempt('different-owner',getRecord('different-owner').updatedAt,String(saved.id)),/not found/);
  await missionAction(actor,{type:'practice-restore',attemptId:saved.id,expectedUpdatedAt:next.updatedAt},'http://localhost:3000');
  const restored=getRecord(actor);assert.equal(restored.wallet,old);assert.equal(restored.trade?.clientId,'draft-only');assert.equal(restored.apiPublicKey,undefined);assert.equal(restored.builderChallenge,undefined);
  assert.equal(practiceHistory(actor).length,0);assert.equal(campaignStats().enrolled,1);
});
test('switching accounts cannot abandon pending payments or orders or race a connection',t=>{
  setup(t);
  const cases=[{practiceGrant:{status:'submitted'}},{deposit:{status:'registered'}},{claim:{status:'reserved'}},{trade:{status:'sent'}},{order:{id:'open-order'}}];
  for(const [i,fields] of cases.entries()) {
    const actor=`pending-${i}`;updateRecord(actor,r=>Object.assign(r,fields));
    assert.throws(()=>switchPracticeAttempt(actor,getRecord(actor).updatedAt),/confirming|verification/);
    assert.equal(practiceHistory(actor).length,0);
  }
  const actor='connection-running';updateRecord(actor,r=>{r.wallet=wallet().address.to_bech32();});const lease=acquireSetup(actor);
  assert.throws(()=>switchPracticeAttempt(actor,getRecord(actor).updatedAt),/request is running/);releaseSetup(lease);
  assert.doesNotThrow(()=>switchPracticeAttempt(actor,getRecord(actor).updatedAt));
});
test('archiving preserves sponsor accounting and prevents a second bounty or same-wallet starter grant',t=>{
  setup(t);const actor='already-paid',address=wallet().address.to_bech32();
  updateRecord(actor,r=>{
    r.wallet=address;r.accountId=account;r.completedAt=now;r.rewardAddress=address;
    r.practiceGrant={status:'confirmed',txHash:'a'.repeat(64),expiresSlot:100,fee:100};
    r.claim={id:'claim-original',status:'confirmed',txHash:'b'.repeat(64),fee:100,confirmedAt:now};
  });
  switchPracticeAttempt(actor,getRecord(actor).updatedAt);
  assert.equal(previousPracticeGrant(actor,address),true);assert.equal(previousPracticeGrant(actor,wallet().address.to_bech32()),false);
  assert.equal(campaignStats().claimsPaid,1);assert.equal(campaignStats().feesPaidLovelace,100);
  updateRecord(actor,r=>{r.completedAt=now;r.rewardAddress=address;});
  assert.throws(()=>reserveClaim(actor),/previous practice attempt/);
  updateRecord('new-login',r=>{r.wallet=address;r.accountId=account;r.completedAt=now;r.rewardAddress=wallet().address.to_bech32();});
  assert.equal(previousPracticeGrant('new-login',address,account),true);
  assert.throws(()=>acquireSetup('new-login',true),/already received/);
  assert.throws(()=>reserveClaim('new-login'),/already has a bounty claim/);
});
test('order verification rejects other owners, pre-lesson, partial, changed, unobserved and non-limit evidence', () => {
  const r: MissionRecord = { id: MISSION, startedAt: now - 1000, updatedAt: now, lessonAt: now - 500, accountId: account };
  assert.equal(validateOrder(open, r, '12345', 'open', now).ID, '12345');
  for (const change of [{ AccountID: '019a0c2e-1111-7000-8000-000000000002' }, { CreateTimestamp: now - 2000 }, { Filled: '0.1' }, { Type: 'market' }, { Status: 'filled' }, { Size: '1000' }, { EventTimestamp: now + 60000 }]) assert.throws(() => validateOrder({ ...open, ...change }, r, '12345', 'open', now));
  assert.throws(() => validateOrder(open, r, '999', 'open', now));
  assert.throws(() => validateOrder({ ...open, Status: 'canceled' }, r, '12345', 'canceled', now));
  r.order = { id: '12345', accountId: account, price: '2300', size: '0.02', side: 'buy', createdAt: now, observedAt: now };
  assert.equal(validateOrder({ ...open, Status: 'canceled' }, r, '12345', 'canceled', now).Status, 'canceled');
  assert.throws(() => validateOrder({ ...open, Status: 'canceled', Price: '0.3' }, r, '12345', 'canceled', now));
});
test('canceled checkpoint accepts equivalent decimal formatting but rejects any actual amount change', () => {
  // Strike returned these amounts with 15/18 fractional places after cancellation.
  const r: MissionRecord = {
    id: MISSION, startedAt: now - 1000, updatedAt: now, lessonAt: now - 500, accountId: account,
    order: { id: '12345', accountId: account, price: '2426.96', size: '0.005', side: 'buy', createdAt: now, observedAt: now },
  };
  const canceled = { ...open, Status: 'canceled', Price: '2426.960000000000000', Size: '0.005000000000000000', Filled: '0.000000000000000000' };
  assert.equal(validateOrder(canceled, r, '12345', 'canceled', now).Status, 'canceled');
  assert.equal(validateOrder({ ...canceled, Price: '0002426.9600', Size: '000.0050' }, r, '12345', 'canceled', now).Status, 'canceled');
  const padded = { ...r, order: { ...r.order!, price: canceled.Price, size: canceled.Size } };
  assert.equal(validateOrder({ ...canceled, Price: '2426.96', Size: '0.005' }, padded, '12345', 'canceled', now).Status, 'canceled');
  // These differences disappear if converted to JavaScript Number; they must still fail.
  for (const change of [
    { Price: '2426.960000000000001' }, { Size: '0.005000000000000001' },
    { Filled: '0.000000000000000001' }, { Side: 'sell' }, { CreateTimestamp: now + 1, EventTimestamp: now + 1 },
    { AccountID: '019a0c2e-1111-7000-8000-000000000002' }, { ID: '12346' },
  ]) assert.throws(() => validateOrder({ ...canceled, ...change }, r, '12345', 'canceled', now));
});
test('real CIP-8 ownership, single-use challenges, server verification and durable mission resumption (synthetic Strike responses)', async t => {
  setup(t); const w = wallet(), origin = 'http://localhost:3000'; const rawOrder = { ...open, CreateTimestamp: Date.now() + 2, EventTimestamp: Date.now() + 2 };
  global.fetch = async input => { const u = new URL(String(input)); assert.equal(u.origin, 'https://api-v2-testnet.strikefinance.org'); assert.equal(u.searchParams.get('blockchain_address'), w.address.to_bech32()); return Response.json(u.pathname === '/v2/account' ? { account_id: account, blockchain: 'cardano', blockchain_address: w.address.to_bech32() } : rawOrder); };
  assert.ok(publicQuestions.every(q => !('answer' in q)));
  await assert.rejects(missionAction('alice', { type: 'lesson', answers: [1, 1, 2] }, origin));
  await missionAction('alice', { type: 'lesson', answers: [0, 1, 2] }, origin);
  const check = await missionAction('alice', { type: 'challenge', purpose: 'strike', address: w.address.to_hex() }, origin);
  assert.ok('challenge' in check); if (!('challenge' in check)) throw new Error('challenge');
  const proof = signature(w, check.challenge.hex);
  await assert.rejects(missionAction('alice', { type: 'link', proof }, 'https://other.test'));
  await missionAction('alice', { type: 'link', proof }, origin);
  await assert.rejects(missionAction('alice', { type: 'link', proof }, origin));
  const originalLesson = getRecord('alice').lessonAt;
  rawOrder.CreateTimestamp = Date.now(); rawOrder.EventTimestamp = rawOrder.CreateTimestamp;
  await missionAction('alice', { type: 'lesson', answers: [0, 1, 2] }, origin);
  assert.equal(getRecord('alice').lessonAt, originalLesson);
  await missionAction('alice', { type: 'observe', orderId: '12345' }, origin);
  assert.equal(status('alice').record?.order?.id, '12345'); assert.equal(status('bob').record?.order, undefined);
  rawOrder.Status = 'canceled';
  const completed = await missionAction('alice', { type: 'verify' }, origin);
  assert.ok(completed.record?.completedAt); assert.match(completed.record!.receipt!, /^[a-f0-9]{64}$/);
  await assert.rejects(missionAction('alice', { type: 'claim' }, origin), /Preprod reward wallet/);
  const reward = await missionAction('alice', { type: 'challenge', purpose: 'reward', address: w.address.to_bech32() }, origin);
  if (!('challenge' in reward)) throw new Error('challenge');
  await missionAction('alice', { type: 'link', proof: signature(w, reward.challenge.hex) }, origin);
  assert.equal(status('alice').record?.rewardAddress, w.address.to_bech32());
  assert.ok(!JSON.stringify(status('alice')).includes('signedTx')); assert.ok(!JSON.stringify(status('alice')).includes('"challenge"'));
  await missionAction('bob', { type: 'lesson', answers: [0, 1, 2] }, origin);
  const duplicate = await missionAction('bob', { type: 'challenge', purpose: 'strike', address: w.address.to_bech32() }, origin);
  if (!('challenge' in duplicate)) throw new Error('challenge');
  await missionAction('bob', { type: 'link', proof: signature(w, duplicate.challenge.hex) }, origin);
  assert.equal(getRecord('bob').wallet,w.address.to_bech32());
  assert.equal(getRecord('bob').completedAt,undefined);
  assert.throws(()=>updateRecord('bob',(_,bind)=>bind('order',`${account}:12345`)),/already linked/);
});
test('testnet client keeps int64 IDs exact and never falls back to mainnet', async t => {
  setup(t);
  global.fetch = async input => { assert.match(String(input), /^https:\/\/api-v2-testnet\.strikefinance\.org\//); return new Response('{"ID":9223372036854775806}'); };
  assert.equal((await orderFor('synthetic-address', '9223372036854775806')).ID, '9223372036854775806');
  process.env.STRIKE_MISSIONS_TESTNET_APP_URL = 'https://app.strikefinance.org'; assert.equal(testnetApp(), null);
  delete process.env.STRIKE_MISSIONS_TESTNET_APP_URL; assert.equal(testnetApp(), 'https://testnet.strikefinance.org/');
  process.env.STRIKE_MISSIONS_TESTNET_APP_URL = 'https://testnet.strikefinance.org.evil.test'; assert.equal(testnetApp(), null);
  process.env.STRIKE_MISSIONS_TESTNET_APP_URL = 'https://testnet-unverified.strikefinance.org'; assert.equal(testnetApp(), null);
});
test('bounty is exactly 2 test ADA, has a valid sponsor signature, refuses mainnet and insufficient funds', t => {
  setup(t); const sponsor = wallet(), recipient = wallet();
  const utxos = [{ tx_hash: 'a'.repeat(64), output_index: 0, amount: [{ unit: 'lovelace', quantity: '10000000' }] }];
  const built = buildBounty(recipient.address.to_bech32(), utxos, params, 1000, sponsor), tx = CSL.Transaction.from_hex(built.signedTx);
  assert.equal(tx.body().outputs().get(0).address().to_bech32(), recipient.address.to_bech32()); assert.equal(tx.body().outputs().get(0).amount().coin().to_str(), '2000000');
  const witness = tx.witness_set().vkeys()!.get(0);
  assert.ok(witness.vkey().public_key().verify(CSL.FixedTransaction.from_hex(built.signedTx).transaction_hash().to_bytes(), witness.signature()));
  assert.ok(built.fee <= 500000); assert.equal(built.expiresSlot, 2800);
  assert.throws(() => buildBounty(CSL.EnterpriseAddress.new(1, CSL.Credential.from_keyhash(recipient.secret.to_public().hash())).to_address().to_bech32(), utxos, params, 1000, sponsor), /Preprod/);
  assert.throws(() => buildBounty(recipient.address.to_bech32(), [], params, 1000, sponsor), /spendable/);
});
test('ambiguous submission resumes the same signed payout; one confirmed claim, lease exclusion, campaign cap', async t => {
  setup(t); const sponsor = wallet(), recipient = wallet();
  fs.writeFileSync(sponsorFile(), JSON.stringify({ purpose: MISSION, network: 'preprod', key: sponsor.secret.to_hex() }), { mode: 0o600 });
  updateRecord('alice', r => { r.completedAt = Date.now(); r.rewardAddress = recipient.address.to_bech32(); });
  let accepted = false, confirmations = false; const broadcasts: string[] = [];
  global.fetch = async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, 'https://cardano-preprod.blockfrost.io');
    if (url.pathname.endsWith('/tx/submit')) {
      const hex = Buffer.from(init!.body as Uint8Array).toString('hex'); broadcasts.push(hex); accepted = true;
      throw new Error('Synthetic timeout after network acceptance');
    }
    if (url.pathname.endsWith('/parameters')) return Response.json(params);
    if (url.pathname.endsWith('/blocks/latest')) return Response.json({ slot: 1000, height: confirmations ? 22 : 20 });
    if (url.pathname.includes('/addresses/')) return Response.json([{ tx_hash: 'a'.repeat(64), output_index: 0, amount: [{ unit: 'lovelace', quantity: '10000000' }] }]);
    if (url.pathname.endsWith('/utxos')) return Response.json({ outputs: [{ address: recipient.address.to_bech32(), amount: [{ unit: 'lovelace', quantity: '2000000' }] }] });
    if (url.pathname.includes('/txs/')) return accepted ? Response.json({ hash: getRecord('alice').claim!.txHash, valid_contract: true, block_height: 20 }) : new Response('', { status: 404 });
    throw new Error('Unexpected fixture URL');
  };
  await assert.rejects(claimBounty('alice'), /acknowledged/);
  const pending = getRecord('alice').claim!; assert.equal(pending.status, 'submitted'); assert.ok(pending.signedTx);
  assert.throws(() => acquireSponsor('bob'), /Another bounty/);
  await claimBounty('alice'); assert.equal(broadcasts.length, 1); assert.equal(getRecord('alice').claim!.txHash, pending.txHash);
  confirmations = true; await claimBounty('alice'); await claimBounty('alice'); assert.equal(broadcasts.length, 1); assert.equal(getRecord('alice').claim!.status, 'confirmed');
  const lease = acquireSponsor('bob'); assert.throws(() => acquireSponsor('alice'), /already running/); releaseSponsor(lease);
  for (let i = 0; i < 19; i++) { updateRecord(`user-${i}`, r => { r.completedAt = now; r.rewardAddress = wallet().address.to_bech32(); }); reserveClaim(`user-${i}`); }
  updateRecord('over-cap', r => { r.completedAt = now; r.rewardAddress = wallet().address.to_bech32(); }); assert.throws(() => reserveClaim('over-cap'), /20-claim limit/);
});
test('API keeps existing auth, isolates users, rejects CSRF/oversize and preserves cookies', async t => {
  setup(t); const user = buildUser({ email: 'mission@example.test', provider: 'email_link' });
  const token = createAppSessionToken(user);
  const req = (body?: unknown, headers = {}) => new Request('http://localhost:3000/api/learn/strike-mission', { method: body === undefined ? 'GET' : 'POST', headers: { cookie: `drmz_user=${token}`, host: 'localhost:3000', origin: 'http://localhost:3000', 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal((await POST(req({ type: 'lesson', answers: [0, 1, 2] }, { cookie: '' }))).status, 401);
  assert.equal((await POST(req({ type: 'claim' }, { origin: 'https://evil.test' }))).status, 403);
  assert.equal((await POST(req({ type: 'claim' }, { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await POST(req({ junk: 'x'.repeat(24001) }))).status, 413);
  assert.equal((await POST(req({ type: 'lesson', answers: [0, 1, 2], actor: 'victim' }))).status, 400);
  const saved = await POST(req({ type: 'lesson', answers: [0, 1, 2] })); assert.equal(saved.status, 200); assert.equal(saved.headers.get('set-cookie'), null);
  assert.ok((await (await GET(req())).json()).record.lessonAt);
  assert.equal((await (await GET(req(undefined, { cookie: '' }))).json()).record, null);
  process.env.STRIKE_MISSIONS_ENABLED = 'false'; process.env = { ...process.env, NODE_ENV: 'production' };
  assert.equal((await POST(req({ type: 'claim' }))).status, 503);
  process.env.STRIKE_MISSIONS_DATA_DIR = '/not-a-writable-mission-directory';
  const disabled = await GET(req()); assert.equal(disabled.status, 200);
  assert.deepEqual((await disabled.json()).record, null);
});
for (const fundedPractice of [false, true]) test(`official builder lifecycle preserves evidence and prevents duplicate orders (funded practice: ${fundedPractice})`, async t => {
  setup(t); process.env.STRIKE_MISSIONS_BUILDER_CODE = 'drmz-test-fixture';
  const w = wallet(), session = newStrikeSession(), origin = 'http://localhost:3000';
  let order: Record<string, unknown> | null = null, creates = 0, builderMessage = '';
  const market = { status: 'trading', mark_price: '2393.15512209', order_min_price: '39.86', order_max_price: '100000', order_tick_price: '0.01', order_limit_price_bound: '0.05', order_limit_step_size: '0.001', order_limit_min_size: '0.001', order_market_min_size: '0.001', order_limit_max_size: '100', order_min_notional: '10' };
  global.fetch = async (input, init) => {
    const u = new URL(String(input)); assert.equal(u.origin, 'https://api-v2-testnet.strikefinance.org');
    if (u.pathname === '/auth/builder/request-signature') {
      const b = JSON.parse(String(init?.body)); assert.equal(b.fee_share_bps, 0); assert.equal(b.public_key, session.publicKey);
      assert.deepEqual(Object.keys(b).sort(), ['address', 'chain', 'code', 'fee_share_bps', 'public_key']);
      builderMessage = `Connect to Strike testnet with fixture key ${b.public_key}`;
      return Response.json({ nonce: 'fixture-once-only', message_to_sign: builderMessage });
    }
    if (u.pathname === '/auth/builder/verify-signature') { assert.deepEqual(Object.keys(JSON.parse(String(init?.body))).sort(), ['nonce', 'wallet_signature']); return Response.json({ account_id: account, api_wallet_public_key: session.publicKey, builder_code: 'drmz-test-fixture', fee_share_bps: 0 }); }
    if (u.pathname === '/v2/account') return Response.json({ account_id: account, blockchain: 'cardano', blockchain_address: w.address.to_bech32(), available_balance: '50' });
    if (u.pathname === '/v2/markets') return Response.json({ markets: { 'ETH-USD': market } });
    if (u.pathname === '/v2/time') return Response.json({ serverTime: Date.now() });
    if (u.pathname === '/v2/order' && init?.method === 'POST') {
      creates++; const b = JSON.parse(String(init.body)); assert.equal(b.symbol, 'ETH-USD'); assert.equal(b.type, 'limit'); assert.equal(b.post_only, true); assert.ok(Number(b.price) * Number(b.size) <= 100);
      order = { ...open, ClientOrderID: b.client_order_id, Price: b.price, Size: b.size, CreateTimestamp: Date.now(), EventTimestamp: Date.now() };
      throw new Error('Synthetic accepted order with interrupted response');
    }
    if (u.pathname === '/v2/order/cancel') {
      assert.equal(init?.method, 'DELETE'); assert.equal(JSON.parse(String(init?.body)).client_order_id, order?.ClientOrderID);
      order!.Status = 'canceled'; order!.EventTimestamp = Date.now();
      // Open-order and history responses can serialize the same values differently.
      order!.Price = `${order!.Price}000000000000`; order!.Size = `${order!.Size}000000000000`; order!.Filled = '0.000000000000000000';
      return Response.json({ sequence_id: 12 });
    }
    if (u.pathname === '/v2/order') return order ? Response.json(order) : new Response('{}', { status: 404 });
    throw new Error(`Unexpected fixture endpoint ${u.pathname}`);
  };
  await missionAction('builder-user', { type: 'lesson', answers: [0, 1, 2] }, origin);
  const legacyAccount = '019a0c2e-1111-7000-8000-000000000008';
  if (fundedPractice) updateRecord('builder-user', r => {
    r.wallet = CSL.EnterpriseAddress.new(1, CSL.Credential.from_keyhash(wallet().secret.to_public().hash())).to_address().to_bech32();
    r.accountId = legacyAccount; r.apiPublicKey = 'a'.repeat(64);
    r.practiceConnection = {wallet:w.address.to_bech32(), walletKey:w.secret.to_public().hash().to_hex(), accountId:account, apiPublicKey:'b'.repeat(64)};
    r.deposit = {requestId:'settled-fixture',accountId:account,address:w.address.to_bech32(),amount:'100000000',usdValue:'21',expires:1,confirmations:2,status:'verified',creditedUsd:'21'};
  });
  const challenge = await missionAction('builder-user', { type: 'builder-challenge', address: w.address.to_hex(), publicKey: session.publicKey }, origin);
  assert.ok('challenge' in challenge);
  await missionAction('builder-user', { type: 'builder-connect', proof: signature(w, Buffer.from(builderMessage).toString('hex')) }, origin);
  assert.equal(status('builder-user').record?.apiPublicKey, session.publicKey);
  assert.equal(status('builder-user').record?.accountId, account);
  if(fundedPractice) { assert.equal(getRecord('builder-user').accountId,legacyAccount); assert.equal(getRecord('builder-user').apiPublicKey,'a'.repeat(64)); }
  await missionAction('builder-user', { type: 'order-prepare' }, origin);
  const planned = getRecord('builder-user').trade!;
  await missionAction('builder-user', { type: 'order-prepare' }, origin); assert.equal(getRecord('builder-user').trade!.clientId, planned.clientId);
  const badHeaders = signTestOrder(session, 'place', planned.body.replace('"buy"', '"sell"'), Date.now());
  await assert.rejects(missionAction('builder-user', { type: 'trade-submit', operation: 'place', headers: badHeaders }, origin), /signed order/); assert.equal(creates, 0);
  const headers = signTestOrder(session, 'place', planned.body, Date.now());
  await assert.rejects(missionAction('builder-user', { type: 'trade-submit', operation: 'place', headers }, origin), /interrupted/); assert.equal(creates, 1);
  await assert.rejects(missionAction('builder-user', { type: 'trade-submit', operation: 'place', headers }, origin), /already sent/); assert.equal(creates, 1);
  await missionAction('builder-user', { type: 'order-check' }, origin); assert.equal(getRecord('builder-user').order?.clientId, planned.clientId);
  await assert.rejects(missionAction('builder-user', { type: 'verify' }, origin), /Cancel/);
  const body = JSON.stringify({ symbol: 'ETH-USD', client_order_id: planned.clientId });
  await missionAction('builder-user', { type: 'trade-submit', operation: 'cancel', headers: signTestOrder(session, 'cancel', body, Date.now()) }, origin);
  await missionAction('builder-user', { type: 'verify' }, origin); assert.ok(getRecord('builder-user').completedAt);
  assert.equal(getRecord('builder-user').workshopAccountId,account);assert.equal(status('builder-user').record?.accountId,account);
  assert.ok(!JSON.stringify(status('builder-user')).includes(Buffer.from(session.privateKey).toString('hex')));
  assert.throws(() => planOrder({ ...market, order_min_price: '10000' }, 'bad-config'), /incompatible/);
  assert.throws(() => planOrder({ ...market, order_min_notional: '200' }, 'over-budget'), /100 test-USD/);
});
test('HTTP gateway failures keep the sent order locked until its outcome is read', async t => {
  setup(t); process.env.STRIKE_MISSIONS_BUILDER_CODE = 'drmz-test-fixture';
  const session = newStrikeSession(), origin = 'http://localhost:3000';
  for (const code of [408, 502]) {
    const actor = `gateway-${code}`;
    const body = JSON.stringify({ symbol: 'ETH-USD', client_order_id: actor });
    updateRecord(actor, r => {
      r.lessonAt = Date.now(); r.accountId = account; r.wallet = 'fixture-wallet'; r.apiPublicKey = session.publicKey;
      r.trade = { clientId: actor, body, price: '2300', size: '0.005', status: 'draft' };
    });
    let requests = 0;
    global.fetch = async () => { requests++; return Response.json({ error: 'Gateway failure after possible acceptance' }, { status: code }); };
    const action = { type: 'trade-submit', operation: 'place', headers: signTestOrder(session, 'place', body, Date.now()) };
    await assert.rejects(missionAction(actor, action, origin));
    assert.equal(getRecord(actor).trade?.status, 'sent');
    await assert.rejects(missionAction(actor, action, origin), /already sent/);
    assert.equal(requests, 1);
  }
});
test('funding checks stay bound to the saved wallet and block unfunded order preparation without losing progress', async t => {
  setup(t); process.env.STRIKE_MISSIONS_BUILDER_CODE = 'drmz-test-fixture';
  const w = wallet(), origin = 'http://localhost:3000';
  updateRecord('funding-user', r => { r.lessonAt = now; r.accountId = account; r.wallet = w.address.to_bech32(); r.apiPublicKey = newStrikeSession().publicKey; });
  let balance = '0', returnedAccount = account;
  global.fetch = async input => {
    const u = new URL(String(input));
    assert.equal(u.origin, 'https://api-v2-testnet.strikefinance.org');
    assert.equal(u.pathname, '/v2/account');
    assert.equal(u.searchParams.get('blockchain_address'), w.address.to_bech32());
    return Response.json({ account_id: returnedAccount, blockchain: 'cardano', blockchain_address: w.address.to_bech32(), available_balance: balance });
  };
  await assert.rejects(missionAction('someone-else', { type: 'account-check' }, origin), /Connect/);
  const empty = await missionAction('funding-user', { type: 'account-check' }, origin);
  assert.ok('funding' in empty && empty.funding && typeof empty.funding === 'object' && 'funded' in empty.funding); assert.equal(empty.funding.funded, false);
  await assert.rejects(missionAction('funding-user', { type: 'order-prepare' }, origin), /no available trading credits/);
  assert.equal(getRecord('funding-user').trade, undefined); assert.equal(getRecord('funding-user').lessonAt, now);
  balance = '50'; const funded = await missionAction('funding-user', { type: 'account-check' }, origin);
  assert.ok('funding' in funded && funded.funding && typeof funded.funding === 'object' && 'availableBalance' in funded.funding); assert.equal(funded.funding.availableBalance, '50');
  returnedAccount = '019a0c2e-1111-7000-8000-000000000002';
  await assert.rejects(missionAction('funding-user', { type: 'account-check' }, origin), /could not verify/);
});
test('builder errors identify setup and expired consent without exposing arbitrary upstream text', async t => {
  setup(t); process.env.STRIKE_MISSIONS_BUILDER_CODE = 'not-registered';
  const w = wallet(); updateRecord('setup-user', r => { r.lessonAt = now; });
  global.fetch = async () => Response.json({ error: 'builder code not found' }, { status: 404 });
  await assert.rejects(missionAction('setup-user', { type: 'builder-challenge', address: w.address.to_hex(), publicKey: newStrikeSession().publicKey }, 'http://localhost:3000'), /not registered on Strike testnet/);
  assert.equal(getRecord('setup-user').builderChallenge, undefined);
  assert.equal(getRecord('setup-user').lessonAt, now);
  assert.match(builderFailure(400, { error: 'builder is not active' }), /inactive/);
  assert.match(builderFailure(400, { error: 'challenge not found or expired' }), /expired/);
  assert.ok(!builderFailure(500, { error: 'private upstream diagnostics' }).includes('private upstream diagnostics'));
});

test('legacy mainnet mission gets an independently verified Preprod setup without changing order, reward, or learning evidence', async t => {
  setup(t); process.env.STRIKE_MISSIONS_BUILDER_CODE = 'fixture-builder';
  const legacy = wallet(), practice = wallet(), session = newStrikeSession();
  const mainnetAddress = CSL.EnterpriseAddress.new(1, CSL.Credential.from_keyhash(legacy.secret.to_public().hash())).to_address().to_bech32();
  const practiceAccount = '019a0c2e-1111-7000-8000-000000000009';
  updateRecord('legacy-learner', r => Object.assign(r, {
    wallet:mainnetAddress,walletKey:legacy.secret.to_public().hash().to_hex(),accountId:account,apiPublicKey:'a'.repeat(64),lessonAt:123,completedAt:456,receipt:'existing-receipt',
    order:{id:'saved-order',accountId:account,price:'2400',size:'0.01',side:'buy',createdAt:200,observedAt:300},
    claim:{id:'paid-bounty',status:'confirmed',txHash:'c'.repeat(64)},
    blockscholar:{enrolledAt:100,reflection:{learning:'saved note',application:'saved work',artifactUrl:'',savedAt:600}},
  }));
  const before=getRecord('legacy-learner'); let challenges=0;
  global.fetch=async(input,init)=>{
    const u=new URL(String(input));assert.equal(u.origin,'https://api-v2-testnet.strikefinance.org');
    if(u.pathname==='/auth/builder/request-signature') { challenges++;const body=JSON.parse(String(init?.body));assert.equal(body.address,practice.address.to_bech32());return Response.json({nonce:'practice-challenge',message_to_sign:'Connect this Preprod practice account'}); }
    if(u.pathname==='/auth/builder/verify-signature')return Response.json({account_id:practiceAccount,api_wallet_public_key:session.publicKey,builder_code:'fixture-builder',fee_share_bps:0});
    assert.equal(u.pathname,'/v2/account');assert.equal(u.searchParams.get('blockchain_address'),practice.address.to_bech32());
    return Response.json({account_id:practiceAccount,blockchain:'cardano',blockchain_address:practice.address.to_bech32(),available_balance:'0'});
  };
  await assert.rejects(missionAction('legacy-learner',{type:'builder-challenge',context:'practice',address:mainnetAddress,publicKey:session.publicKey},'http://localhost:3000'),/Preprod/);
  assert.equal(challenges,0);
  const check=await missionAction('legacy-learner',{type:'builder-challenge',context:'practice',address:practice.address.to_hex(),publicKey:session.publicKey},'http://localhost:3000');
  assert.ok('challenge' in check);
  await missionAction('legacy-learner',{type:'builder-connect',proof:signature(practice,check.challenge.hex)},'http://localhost:3000');
  updateRecord('legacy-learner', r => { r.deposit={requestId:'separate-funded-deposit',accountId:practiceAccount,address:practice.address.to_bech32(),amount:'100000000',usdValue:'20',expires:1,confirmations:2,status:'verified',creditedUsd:'20'}; });
  assert.equal(status('legacy-learner').record?.accountId,account);
  const after=getRecord('legacy-learner');
  for(const key of ['wallet','walletKey','accountId','apiPublicKey','lessonAt','completedAt','receipt','order','claim','blockscholar'] as const) assert.deepEqual(after[key],before[key]);
  assert.equal(after.practiceConnection?.wallet,practice.address.to_bech32());assert.equal(after.practiceConnection?.accountId,practiceAccount);
  assert.equal(after.practiceConnection?.apiPublicKey,session.publicKey);
  assert.ok(!JSON.stringify(status('legacy-learner').record?.practiceConnection).includes('walletKey'));
  const balance=await missionAction('legacy-learner',{type:'practice-account-check'},'http://localhost:3000');
  assert.ok('funding' in balance && balance.funding && typeof balance.funding==='object' && 'accountId' in balance.funding);
  assert.equal(balance.funding.accountId,practiceAccount);
  await assert.rejects(missionAction('legacy-learner',{type:'builder-challenge',context:'practice',address:wallet().address.to_hex(),publicKey:session.publicKey},'http://localhost:3000'),/already linked/);
  assert.equal(challenges,1);
});
