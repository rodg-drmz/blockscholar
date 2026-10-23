import { createHash, randomBytes } from 'node:crypto';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import { paymentIdentity, verifyBadgeWalletSignature } from '../auth/cardano-proof';
import { actionSchema, practiceRecord, workshopRecord, grade, MISSION, MissionError, publicQuestions, publicRecord, REWARD } from './model';
import { getRecord, rateLimit, updateRecord, practiceHistory, switchPracticeAttempt, previousPracticeGrant, acquireSetup, releaseSetup } from './store';
import { accountFor, accountFunding, orderFor, orderForClient, validateOrder, STRIKE_TESTNET_APP } from './strike';
import { claimBounty, sponsorStatus } from './bounty';
import { builderCode, tradingAction } from './trading';
import { practiceStatus, fundPractice } from './practice-funding';
import { depositAction } from './deposit';
import {positionAction,positionScenarios} from './positions';

export function enabled() { return process.env.STRIKE_MISSIONS_ENABLED === undefined ? process.env.NODE_ENV !== 'production' : process.env.STRIKE_MISSIONS_ENABLED === 'true'; }
export function testnetApp() {
  // Official testnet UI, verified through the main app's network switch.
  try {
    const u = new URL(process.env.STRIKE_MISSIONS_TESTNET_APP_URL || STRIKE_TESTNET_APP);
    return u.origin === STRIKE_TESTNET_APP && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}
export function status(actor?: string) {
  const active = enabled();
  const saved = active && actor ? getRecord(actor) : null;
  return { enabled: active, authenticated: !!actor, record: saved ? publicRecord(workshopRecord(saved)) : null, questions: publicQuestions, positionScenarios,
    previousAttempts: active && actor ? practiceHistory(actor) : [],
    previousGrant: saved && actor && practiceRecord(saved).wallet ? previousPracticeGrant(actor,practiceRecord(saved).wallet!,practiceRecord(saved).accountId) : false,
    practiceSponsor: active ? practiceStatus() : {configured: false, address: null},
    reward: { lovelace: REWARD, unit: 'Preprod test ADA', limit: 20, ...(active ? sponsorStatus() : { configured: false, address: null, network: 'preprod' }) }, testnetApp: active ? testnetApp() : null, builderConfigured: active && !!builderCode() };
}
export async function missionAction(actor: string, body: unknown, origin: string) {
  if (!enabled()) throw new MissionError('This testnet mission has not been enabled on this deployment.', 503);
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) throw new MissionError('Invalid mission request.');
  rateLimit(actor);
  const a = parsed.data;
  if(a.type==='position-scenario' || a.type==='position-prepare' || a.type==='position-submit' || a.type==='position-check') {
    const result=await positionAction(actor,a);return {...status(actor),...result};
  }
  if (a.type === 'practice-restart' || a.type === 'practice-restore') {
    switchPracticeAttempt(actor,a.expectedUpdatedAt,a.type === 'practice-restore' ? a.attemptId : undefined);
    return status(actor);
  }
  if (a.type === 'practice-existing') {
    const r = getRecord(actor);
    if (!r.wallet || !r.accountId || !(await accountFunding(r.wallet, r.accountId)).funded) throw new MissionError('Check your Strike test balance first.');
    updateRecord(actor, latest => { latest.practiceExistingAt ??= Date.now(); });
    return status(actor);
  }
  if (a.type === 'practice-fund' || a.type === 'practice-check') {
    await fundPractice(actor, a.type === 'practice-check'); return status(actor);
  }
  if (a.type.startsWith('deposit-')) { const result = await depositAction(actor, a); return {...status(actor), ...result}; }
  if (a.type === 'account-check' || a.type === 'practice-account-check') {
    const r = a.type === 'practice-account-check' ? practiceRecord(getRecord(actor)) : workshopRecord(getRecord(actor));
    if (!r.accountId || !r.wallet) throw new MissionError('Connect your Strike testnet account first.');
    return { ...status(actor), funding: await accountFunding(r.wallet, r.accountId) };
  }
  if (['builder-challenge', 'builder-connect', 'order-prepare', 'trade-submit', 'trade-clock'].includes(a.type)) {
    const lease = ['builder-challenge','builder-connect'].includes(a.type) ? acquireSetup(actor) : null;
    try {
      const result = await tradingAction(actor, a, origin);
      return { ...status(actor), ...result };
    } finally { if (lease) releaseSetup(lease); }
  }
  if (a.type === 'program-enroll') {
    updateRecord(actor, r => { r.blockscholar ??= { enrolledAt: Date.now() }; });
  } else if (a.type === 'program-reflection') {
    updateRecord(actor, r => {
      if (!r.blockscholar) throw new MissionError('Join the DRMZ Blockscholar program before saving your field notes.');
      r.blockscholar.reflection = { learning: a.learning, application: a.application, artifactUrl: a.artifactUrl, savedAt: Date.now() };
    });
  } else if (a.type === 'lesson') {
    grade(a.answers);
    updateRecord(actor, r => { r.lessonAt ??= Date.now(); });
  } else if (a.type === 'challenge') {
    const current = getRecord(actor);
    if (!current.lessonAt) throw new MissionError('Pass the three lesson checks first.');
    if (a.purpose === 'strike' && current.accountId) throw new MissionError('Your Strike account is already linked.');
    if (a.purpose === 'reward' && current.claim) throw new MissionError('The reward address is locked to your saved claim.');
    let identity; let network: 'mainnet' | 'preprod';
    try {
      const address = /^[a-f0-9]+$/i.test(a.address) ? CSL.Address.from_hex(a.address) : CSL.Address.from_bech32(a.address);
      network = address.network_id() === 1 ? 'mainnet' : 'preprod';
      identity = paymentIdentity(address.to_bech32(), network);
      if (a.purpose === 'reward' && network !== 'preprod') throw new Error('wrong network');
    } catch { throw new MissionError(a.purpose === 'reward' ? 'Switch your Cardano wallet to Preprod to receive test ADA.' : 'Connect a Cardano payment-key wallet.'); }
    const expires = Date.now() + 5 * 60_000;
    const message = `DRMZ Strike testnet mission\nSite: ${origin}\nPurpose: ${a.purpose === 'strike' ? 'Verify ownership of my Strike testnet account wallet' : 'Set my Cardano Preprod test-ADA bounty address'}\nWallet: ${identity.address}\nMission: ${MISSION}\nNonce: ${randomBytes(24).toString('hex')}\nExpires: ${new Date(expires).toISOString()}\nThis signs a message only. It does not authorize a trade, transfer, or change your DRMZ sign-in.`;
    const hex = Buffer.from(message).toString('hex');
    updateRecord(actor, r => { r.challenge = { purpose: a.purpose, address: identity.address, network, key: identity.ownerKeyHash, hex, origin, expires }; });
    return { ...status(actor), challenge: { message, hex, addressHex: identity.addressHex } };
  } else if (a.type === 'link') {
    const c = getRecord(actor).challenge;
    if (!c || c.expires < Date.now() || c.origin !== origin) throw new MissionError('The wallet check expired. Connect again.');
    // Consume before any external await; a second tab cannot replay this signature.
    const consumed = updateRecord(actor, r => { if (r.challenge?.hex !== c.hex) throw new MissionError('Wallet check changed. Retry.'); delete r.challenge; });
    if (!await verifyBadgeWalletSignature(c.address, c.hex, a.proof, c.network)) throw new MissionError('That wallet signature did not match this mission check. Please reconnect.');
    if (c.purpose === 'strike') {
      const accountId = await accountFor(c.address);
      updateRecord(actor, (r, bind) => {
        if (r.updatedAt !== consumed.updatedAt) throw new MissionError('Your practice changed during wallet approval. Connect again.',409);
        if (r.accountId) throw new MissionError('A Strike account is already linked.');
        bind('wallet', c.key); bind('account', accountId);
        r.wallet = c.address; r.walletKey = c.key; r.accountId = accountId;
      });
    } else updateRecord(actor, (r, bind) => {
      if (r.updatedAt !== consumed.updatedAt) throw new MissionError('Your practice changed during wallet approval. Connect again.',409);
      if (r.claim) throw new MissionError('The reward address is locked to your saved claim.');
      bind('reward', c.key); r.rewardAddress = c.address; r.rewardKey = c.key;
    });
  } else if (a.type === 'observe' || a.type === 'verify' || a.type === 'order-check') {
    const r = workshopRecord(getRecord(actor));
    if (!r.lessonAt || !r.wallet || !r.accountId) throw new MissionError('Pass the lesson and link your Strike testnet account first.');
    if (r.completedAt) return status(actor);
    const automated = a.type === 'order-check';
    if (automated && !r.trade) throw new MissionError('Prepare and send the mission order first.');
    const raw = automated ? await orderForClient(r.wallet, r.trade!.clientId) : null;
    if (raw && (raw.ClientOrderID !== r.trade!.clientId || raw.AccountID !== r.accountId)) throw new MissionError('Strike returned an order belonging to a different request.');
    if (raw && ['rejected', 'expired'].includes(raw.Status)) {
      updateRecord(actor, latest => { if (latest.trade?.clientId === r.trade!.clientId) latest.trade.status = 'rejected'; });
      throw new MissionError('Strike rejected or expired this order. Check test funding and prepare a fresh practice order.');
    }
    const phase = a.type === 'observe' || automated && raw?.Status === 'open' ? 'open' : 'canceled';
    const id = automated ? String(raw?.ID || '') : a.type === 'observe' ? a.orderId : r.order?.id;
    if (!id) throw new MissionError('Save an open-order checkpoint first.');
    const o = validateOrder(raw || await orderFor(r.wallet, id), r, id, phase);
    updateRecord(actor, (latest, bind) => {
      if (latest.completedAt) return;
      if (phase === 'open') {
        if (workshopRecord(latest).accountId !== r.accountId) throw new MissionError('The workshop account changed. Check the saved order again.', 409);
        bind('order', `${r.accountId}:${id}`);
        latest.workshopAccountId = r.accountId;
        latest.order = { id, accountId: o.AccountID, price: o.Price, size: o.Size, side: o.Side, createdAt: o.CreateTimestamp, observedAt: Date.now(), ...(automated ? { clientId: r.trade!.clientId } : {}) };
      } else {
        validateOrder(o, workshopRecord(latest), id, 'canceled');
        latest.completedAt = Date.now();
        latest.receipt = createHash('sha256').update(JSON.stringify({ mission: MISSION, network: 'strike-testnet', account: workshopRecord(latest).accountId, open: latest.order, canceled: o, verifiedAt: latest.completedAt })).digest('hex');
      }
    });
  } else if (a.type === 'claim' || a.type === 'receipt') {
    if (a.type === 'receipt' && !getRecord(actor).claim?.signedTx) throw new MissionError('No payment has been submitted yet.');
    await claimBounty(actor);
  }
  return status(actor);
}
