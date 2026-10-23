import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import { buildUser, createAppSessionToken } from '../../app/api/lib/auth-session';
import { POST } from '../../app/api/learn/strike-mission/route';
import { GET } from '../../app/api/learn/blockscholar/route';
import { GET as fundGET } from '../../app/api/learn/dream-fund/route';
import { missionAction } from '../strike-missions/service';
import { getRecord, updateRecord } from '../strike-missions/store';
import { buildBounty, sponsorFile, summarizeSponsorUtxos } from '../strike-missions/bounty';
import { updatePractice } from '../spaces/learning-store';
import { curriculum } from '../spaces/learning-practice.mjs';
import { dreamFund, resetFundCache } from './fund';
import { normalizeMarkets, resetMarketsCache, strikeMarkets } from './markets';
import { exposureExample, programMilestones, nextProgramStep } from './program.mjs';

test('Continue restores the earliest unfinished milestone without treating a payout as course completion', () => {
  assert.equal(nextProgramStep(null, null), 'learn');
  assert.equal(nextProgramStep({ prepScore: 6, challengeScore: 2 }, { completedAt: 1 }), 'work');
  assert.equal(nextProgramStep({ prepScore: 8, challengeScore: 3 }, { claim: { status: 'confirmed' } }), 'mission');
  assert.equal(nextProgramStep({ prepScore: 8, challengeScore: 4 }, { completedAt: 1 }), 'work');
  assert.equal(nextProgramStep({ prepScore: 8, challengeScore: 4 }, { completedAt: 1, blockscholar: { reflection: {} } }), 'work');
});

test('optional training never blocks the workshop or changes existing completion and bounty records', () => {
  for (const challengeScore of [0, 2, 4]) {
    const practice = { prepScore: 6, challengeScore };
    assert.equal(nextProgramStep(practice, {}), 'mission');
    const mission = { lessonAt: 10, completedAt: 20, claim: { status: 'confirmed', txHash: 'saved-receipt' }, blockscholar: { reflection: { learning: 'saved note' } } };
    const before = structuredClone(mission);
    assert.deepEqual(programMilestones(practice, mission), [true, true, true]);
    assert.equal(nextProgramStep(practice, mission), 'work');
    assert.deepEqual(mission, before);
  }
  assert.equal(nextProgramStep({ prepScore: 5, challengeScore: 4 }, {}), 'learn');
});

function setup(t: test.TestContext) {
  const env = { ...process.env }, fetcher = global.fetch, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blockscholar-test-'));
  process.env.STRIKE_MISSIONS_DATA_DIR = dir; process.env.DRMZ_LEARN_DATA_DIR = dir;
  process.env.STRIKE_MISSIONS_ENABLED = 'true'; process.env.STRIKE_MISSIONS_BLOCKFROST_PREPROD = 'preprod-synthetic-key';
  process.env.DRMZ_APP_SESSION_SECRET = 'blockscholar-test-only-secret-more-than-32';
  resetFundCache(); resetMarketsCache();
  global.fetch = async () => { throw new Error('Unexpected external request in test'); };
  t.after(() => { process.env = env; global.fetch = fetcher; resetFundCache(); resetMarketsCache(); fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}
function sponsor() {
  const secret = CSL.PrivateKey.generate_ed25519(), address = CSL.EnterpriseAddress.new(0, CSL.Credential.from_keyhash(secret.to_public().hash())).to_address();
  fs.writeFileSync(sponsorFile(), JSON.stringify({ network: 'preprod', purpose: 'strike-limit-lab-v1', key: secret.to_hex() }), { mode: 0o600 });
  return { secret, address };
}
const origin = 'http://localhost:3000';
const notes = { type: 'program-reflection', learning: 'I inspected an open order and checked that no quantity had filled before cancellation.', application: 'I can document an approval workflow and distinguish an accepted request from a confirmed result.', artifactUrl: 'https://example.test/my-synthetic-artifact' };
test('program enrollment and notes persist without resetting legacy mission evidence or changing reward eligibility', async t => {
  setup(t);
  updateRecord('legacy', r => { r.lessonAt = 100; r.completedAt = 200; r.receipt = 'a'.repeat(64); r.claim = { id: 'existing', status: 'confirmed', txHash: 'b'.repeat(64) }; });
  const before = getRecord('legacy');
  await missionAction('legacy', { type: 'program-enroll' }, origin);
  const enrolled = getRecord('legacy').blockscholar!.enrolledAt;
  await missionAction('legacy', { type: 'program-enroll' }, origin);
  await missionAction('legacy', notes, origin);
  const after = getRecord('legacy');
  assert.equal(after.blockscholar!.enrolledAt, enrolled); assert.equal(after.lessonAt, before.lessonAt);
  assert.equal(after.completedAt, before.completedAt); assert.deepEqual(after.claim, before.claim);
  assert.equal(after.blockscholar!.reflection!.learning, notes.learning);
  await assert.rejects(missionAction('new-person', notes, origin), /Join/);
  await missionAction('new-person', { type: 'program-enroll' }, origin);
  await missionAction('new-person', notes, origin);
  assert.equal(getRecord('new-person').completedAt, undefined);
  await assert.rejects(missionAction('new-person', { type: 'claim' }, origin), /Complete the mission/);
  for (const change of [{ learning: 'short' }, { application: 'x'.repeat(2001) }, { artifactUrl: 'javascript:alert(1)' }, { artifactUrl: 'https://user:secret@example.test' }, { actor: 'legacy' }]) {
    await assert.rejects(missionAction('new-person', { ...notes, ...change }, origin), /Invalid mission request/);
  }
});
test('combined program API restores only the signed-in account and retains existing CSRF and session cookies', async t => {
  setup(t);
  const user = buildUser({ email: 'blockscholar-fixture@example.test', provider: 'email_link' });
  const req = (body?: unknown, extra = {}) => new Request(`${origin}/api/learn/blockscholar`, { method: body ? 'POST' : 'GET', headers: { cookie: `drmz_user=${createAppSessionToken(user)}`, host: 'localhost:3000', origin, 'content-type': 'application/json', ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await POST(req({ type: 'program-enroll' }, { cookie: '' }))).status, 401);
  assert.equal((await POST(req({ type: 'program-enroll' }, { origin: 'https://untrusted.test' }))).status, 403);
  const joined = await POST(req({ type: 'program-enroll' })); assert.equal(joined.status, 200); assert.equal(joined.headers.get('set-cookie'), null);
  await POST(req(notes));
  updatePractice(user.id, { type: 'prep', answers: curriculum.prep.map(q => q.correct) });
  const response = await GET(req()), saved = await response.json();
  assert.equal(saved.practice.prepScore, 8); assert.equal(saved.mission.record.blockscholar.reflection.learning, notes.learning);
  const other = buildUser({ email: 'other-fixture@example.test', provider: 'email_link' });
  const isolated = await (await GET(req(undefined, { cookie: `drmz_user=${createAppSessionToken(other)}` }))).json();
  assert.equal(isolated.practice.prepScore, 0); assert.equal(isolated.mission.record.blockscholar, undefined);
  const anonymous = await (await GET(req(undefined, { cookie: '' }))).json();
  assert.equal(anonymous.practice, null); assert.equal(anonymous.mission.record, null); assert.equal(anonymous.viewer, null);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});
test('fund shows actual funding capacity, aggregate outcomes and confirmed receipts without personal evidence', async t => {
  setup(t); const wallet = sponsor();
  updateRecord('learner', r => {
    r.blockscholar = { enrolledAt: 10, reflection: { ...notes, savedAt: 20 } };
    r.wallet = 'PRIVATE-WALLET'; r.accountId = 'PRIVATE-ACCOUNT'; r.completedAt = 30;
    r.claim = { id: 'paid', status: 'confirmed', txHash: 'a'.repeat(64), fee: 170000, confirmedAt: 40 };
  });
  updateRecord('waiting', r => { r.completedAt = 50; });
  let reads = 0;
  global.fetch = async (url, init) => {
    reads++; assert.equal(new URL(String(url)).origin, 'https://cardano-preprod.blockfrost.io'); assert.notEqual(init?.method, 'POST');
    return Response.json([{ tx_hash: 'b'.repeat(64), output_index: 0, amount: [{ unit: 'lovelace', quantity: '10000000' }] }]);
  };
  const fund = await dreamFund(); if (!('stats' in fund)) throw new Error('disabled');
  assert.equal(fund.address, wallet.address.to_bech32()); assert.equal(fund.estimatedFundedClaims, 1);
  assert.equal(fund.maximumClaims, 20); assert.equal(fund.remainingClaims, 19); assert.equal(fund.paidLovelace, 2000000);
  assert.equal(fund.verifiedUnpaidLovelace, 5000000); assert.equal(fund.stats.feesPaidLovelace, 170000);
  assert.equal(fund.stats.enrolled, 1); assert.equal(fund.stats.fieldNotes, 1);
  const publicBody = JSON.stringify(await (await fundGET()).json());
  for (const secret of [wallet.secret.to_hex(), notes.learning, notes.artifactUrl, 'PRIVATE-WALLET', 'PRIVATE-ACCOUNT', 'signedTx', 'actor']) assert.ok(!publicBody.includes(secret));
  assert.equal(reads, 1, 'read-only fund snapshot is cached');
});
test('failed network balance remains unknown; disabled deployments never read the sponsor', async t => {
  setup(t); sponsor();
  const fund = await dreamFund(); if (!('stats' in fund)) throw new Error('disabled');
  assert.equal(fund.fundingStatus, 'unavailable'); assert.equal(fund.balance, null); assert.equal(fund.estimatedFundedClaims, null);
  process.env.STRIKE_MISSIONS_ENABLED = 'false'; process.env.STRIKE_MISSIONS_DATA_DIR = '/not-a-writable-test-path';
  assert.deepEqual(await dreamFund(), { enabled: false });
});
test('a nearly depleted sponsor is not advertised as funding a complete program', async t => {
  setup(t); sponsor();
  global.fetch = async () => Response.json([{ tx_hash: 'b'.repeat(64), output_index: 0, amount: [{ unit: 'lovelace', quantity: '3497953' }] }]);
  const fund = await dreamFund(); if (!('stats' in fund)) throw new Error('disabled');
  assert.equal(fund.fundingStatus, 'needs-funding');
  assert.equal(fund.estimatedFundedClaims, 0);
  assert.equal(fund.changeReserveLovelace, 1000000);
});
test('fund capacity excludes token-bearing outputs and inputs locked by a saved payout', t => {
  setup(t); const wallet = sponsor();
  const inputs = [{ tx_hash: 'a'.repeat(64), output_index: 0, amount: [{ unit: 'lovelace', quantity: '10000000' }] }];
  const params = { min_fee_a: 44, min_fee_b: 155381, coins_per_utxo_size: '4310', pool_deposit: '500000000', key_deposit: '2000000', max_val_size: '5000', max_tx_size: 16384 };
  const tx = buildBounty(wallet.address.to_bech32(), inputs, params, 1000, wallet);
  const mixed = [...inputs, { tx_hash: 'b'.repeat(64), output_index: 0, amount: [{ unit: 'lovelace', quantity: '5000000' }, { unit: 'asset', quantity: '1' }] }];
  assert.deepEqual(summarizeSponsorUtxos(mixed, []), { balanceLovelace: 15000000, spendableLovelace: 10000000 });
  assert.deepEqual(summarizeSponsorUtxos(mixed, [tx.signedTx]), { balanceLovelace: 15000000, spendableLovelace: 0 });
});
test('read-only market panel flags incompatible rules and uses only the testnet public API', async t => {
  setup(t);
  const raw = { markets: { 'ETH-USD': { status: 'trading', mark_price: '2500', order_min_price: '10', order_max_price: '10000' }, 'ADA-USD': { status: 'trading', mark_price: '0.25', order_min_price: '10', order_max_price: '20000' } } };
  assert.equal(normalizeMarkets(raw)[0].boundsConsistent, true); assert.equal(normalizeMarkets(raw)[1].boundsConsistent, false);
  assert.throws(() => normalizeMarkets({ markets: { 'ETH-USD': { mark_price: 'NaN' } } }));
  global.fetch = async (url, init) => { assert.equal(url, 'https://api-v2-testnet.strikefinance.org/v2/markets'); assert.equal(init?.headers, undefined); assert.equal(init?.method, undefined); return Response.json(raw); };
  assert.equal((await strikeMarkets())?.markets.length, 2);
  assert.equal(exposureExample(100, -2, 'long'), -2); assert.equal(exposureExample(100, -2, 'short'), 2);
  assert.equal(exposureExample(NaN, 3), null); assert.equal(exposureExample(100, 101), null);
  assert.deepEqual(programMilestones({ prepScore: 8, challengeScore: 4 }, { completedAt: 1, blockscholar: { reflection: notes } }), [true, true, true]);
});
