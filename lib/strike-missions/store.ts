import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { MAX_CLAIMS, MISSION, MissionError, workshopRecord, practiceRecord, type MissionRecord, type ClaimKind, REWARD, FIELD_NOTE_REWARD } from './model';

export const dataDir = () => process.env.STRIKE_MISSIONS_DATA_DIR || path.join(process.env.DRMZ_LEARN_DATA_DIR || path.join(process.cwd(), 'data'), 'strike-missions');
const subject = (actor: string) => createHash('sha256').update(`${MISSION}:${actor}`).digest('hex');
function database<T>(fn: (db: DatabaseSync) => T): T {
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  const file = path.join(dataDir(), 'missions.sqlite3'), db = new DatabaseSync(file);
  try {
    chmodSync(file, 0o600);
    db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS missions(actor TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS practice_history(id TEXT PRIMARY KEY, actor TEXT NOT NULL, saved_at INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS unique_evidence(kind TEXT, value TEXT, actor TEXT NOT NULL, PRIMARY KEY(kind,value));
      CREATE TABLE IF NOT EXISTS leases(name TEXT PRIMARY KEY, token TEXT, expires INTEGER);
      CREATE TABLE IF NOT EXISTS limits(actor TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
      BEGIN IMMEDIATE;`);
    const result = fn(db); db.exec('COMMIT'); return result;
  } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; } finally { db.close(); }
}
function read(db: DatabaseSync, actor: string): MissionRecord {
  const row = db.prepare('SELECT payload FROM missions WHERE actor=?').get(subject(actor));
  return row ? JSON.parse(String(row.payload)) : { id: MISSION, startedAt: Date.now(), updatedAt: Date.now() };
}
export function getRecord(actor: string) { return database(db => read(db, actor)); }
function history(db: DatabaseSync, actor?: string) {
  return actor ? db.prepare('SELECT * FROM practice_history WHERE actor=? ORDER BY saved_at DESC').all(subject(actor)) : db.prepare('SELECT * FROM practice_history').all();
}
export function practiceHistory(actor: string) {
  return database(db => history(db,actor).map(row => {
    const r = JSON.parse(String(row.payload)) as MissionRecord;
    return {id:row.id, savedAt:row.saved_at, wallet:r.practiceConnection?.wallet || r.wallet || null, depositTx:r.deposit?.txHash || null, creditedUsd:r.deposit?.creditedUsd || null, completed:!!r.completedAt};
  }));
}
export function previousPracticeGrant(actor: string, wallet: string, accountId?: string) {
  return database(db => [...db.prepare('SELECT actor,payload FROM missions WHERE actor<>?').all(subject(actor)),...history(db)].some(row => {
    const r = JSON.parse(String(row.payload)) as MissionRecord;
    const practice=practiceRecord(r);
    return !!r.practiceGrant && (practice.wallet === wallet || !!accountId && practice.accountId === accountId);
  }));
}
function safeToSwitch(r: MissionRecord) {
  if (Object.values(r.positions || {}).some(p=>p.entry?.sentAt && !p.completedAt)) throw new MissionError('Finish checking and closing your long or short mission before changing practice accounts.',409);
  if (r.practiceGrant?.status === 'submitted' || r.deposit && ['submitted','registered'].includes(r.deposit.status) || r.claim && r.claim.status !== 'confirmed' || r.fieldNoteClaim && r.fieldNoteClaim.status !== 'confirmed') throw new MissionError('A saved payment is still confirming. Finish checking its receipt before switching practice accounts.',409);
  if (!r.completedAt && (r.trade?.status === 'sent' || r.order)) throw new MissionError('Your practice order still needs verification. Cancel and verify it before switching accounts.',409);
}
/** Archive instead of deleting: receipts, unique evidence and sponsor limits survive a restart. */
export function switchPracticeAttempt(actor: string, expectedUpdatedAt: number, restoreId?: string) {
  return database(db => {
    const current=read(db,actor), id=subject(actor);
    if (current.updatedAt !== expectedUpdatedAt) throw new MissionError('Your saved practice changed in another tab. Reload it before switching accounts.',409);
    safeToSwitch(current);
    if (db.prepare('SELECT name FROM leases WHERE expires>? AND name IN (?,?,?,?)').get(Date.now(),`deposit:${id}`,'practice-sponsor','sponsor',`position:${workshopRecord(current).accountId}`)) throw new MissionError('A payment or trading request is running. Wait for it to finish before switching accounts.',409);
    const saved = restoreId ? db.prepare('SELECT payload FROM practice_history WHERE id=? AND actor=?').get(restoreId,id) : undefined;
    if (restoreId && !saved) throw new MissionError('That saved practice account was not found.',404);
    const next: MissionRecord = saved ? JSON.parse(String(saved.payload)) : {id:MISSION,startedAt:Date.now(),updatedAt:Date.now()};
    safeToSwitch(next);
    // Learning belongs to the DRMZ identity, not to whichever test wallet is connected.
    next.lessonAt = current.lessonAt || next.lessonAt;
    next.blockscholar = current.blockscholar || next.blockscholar;
    delete next.builderChallenge; delete next.challenge; delete next.depositRequest;
    delete next.apiPublicKey;
    if (next.practiceConnection) next.practiceConnection.apiPublicKey = '';
    if (current.wallet || current.accountId || current.deposit || current.claim) {
      delete current.builderChallenge; delete current.challenge; delete current.depositRequest;
      db.prepare('INSERT INTO practice_history VALUES(?,?,?,?)').run(randomUUID(),id,Date.now(),JSON.stringify(current));
    }
    if (restoreId) db.prepare('DELETE FROM practice_history WHERE id=? AND actor=?').run(restoreId,id);
    next.updatedAt=Math.max(Date.now(),current.updatedAt+1);
    db.prepare('INSERT OR REPLACE INTO missions VALUES(?,?)').run(id,JSON.stringify(next));
  });
}
export function updateRecord(actor: string, fn: (r: MissionRecord, bind: (kind: string, value: string) => void) => void) {
  return database(db => {
    const record = read(db, actor), id = subject(actor);
    const bind = (kind: string, value: string) => {
      const existing = db.prepare('SELECT actor FROM unique_evidence WHERE kind=? AND value=?').get(kind, value);
      // A valid fresh ownership proof may connect the same wallet from another
      // DRMZ login. Order evidence stays exclusive; payouts are checked globally.
      if (existing && existing.actor !== id && !['wallet','account','reward'].includes(kind)) throw new MissionError('This order is already linked to another mission record.', 409);
      db.prepare('INSERT OR IGNORE INTO unique_evidence VALUES(?,?,?)').run(kind, value, id);
    };
    fn(record, bind); record.updatedAt = Math.max(Date.now(),record.updatedAt+1);
    db.prepare('INSERT OR REPLACE INTO missions VALUES(?,?)').run(id, JSON.stringify(record));
    return record;
  });
}
export function reserveClaim(actor: string, kind: ClaimKind = 'claim') {
  return database(db => {
    const r = read(db, actor);
    if (!r.completedAt || !r.rewardAddress) throw new MissionError('Complete the mission and verify a Preprod reward wallet first.');
    if (kind === 'fieldNoteClaim' && (r.claim?.status !== 'confirmed' || !r.blockscholar?.reflection || r.blockscholar.reflection.learning.trim().length < 30 || r.blockscholar.reflection.application.trim().length < 30)) throw new MissionError('Save your field note and confirm the first 2-test-ADA bounty before claiming the final 3 test ADA.');
    if (r[kind]) return r;
    if (history(db,actor).some(row => JSON.parse(String(row.payload))[kind])) throw new MissionError('Your bounty is already saved with a previous practice attempt. Restore it to view the receipt.',409);
    const rows = [...db.prepare('SELECT payload FROM missions').all(),...history(db)];
    const target=workshopRecord(r);
    if (rows.some(row=>{
      const previous=JSON.parse(String(row.payload)) as MissionRecord, account=workshopRecord(previous);
      return !!previous[kind] && (!!target.accountId && account.accountId===target.accountId || !!target.walletKey && account.walletKey===target.walletKey || !!r.rewardKey && previous.rewardKey===r.rewardKey || !!r.rewardAddress && previous.rewardAddress===r.rewardAddress);
    })) throw new MissionError('This wallet or Strike account already has a bounty claim. Signing in another way does not create a second reward.',409);
    if (rows.filter(row => (JSON.parse(String(row.payload)) as MissionRecord)[kind]).length >= MAX_CLAIMS) throw new MissionError('This test campaign has reached its 20-claim limit.', 409);
    r[kind] = { id: randomUUID(), status: 'reserved' }; r.updatedAt = Date.now();
    db.prepare('INSERT OR REPLACE INTO missions VALUES(?,?)').run(subject(actor), JSON.stringify(r));
    return r;
  });
}
/** A single in-flight payment avoids sponsor UTXO races. Signed outboxes never expire automatically. */
export function acquireSponsor(actor: string) {
  return database(db => {
    const other = db.prepare('SELECT actor,payload FROM missions').all().find(row => {
      const r = JSON.parse(String(row.payload)) as MissionRecord;
      return row.actor !== subject(actor) && [r.claim, r.fieldNoteClaim].some(claim => claim?.signedTx && claim.status !== 'confirmed');
    });
    if (other) throw new MissionError('Another bounty is confirming. Your completion is saved; retry shortly.', 409);
    const lease = db.prepare('SELECT expires FROM leases WHERE name=?').get('sponsor');
    if (lease && Number(lease.expires) > Date.now()) throw new MissionError('A bounty request is already running. Please wait a moment.', 409);
    const token = randomUUID();
    db.prepare('INSERT OR REPLACE INTO leases VALUES(?,?,?)').run('sponsor', token, Date.now() + 120_000);
    return token;
  });
}
export function withSponsorLease(actor: string, token: string, fn: (r: MissionRecord) => void) {
  return database(db => {
    const lease = db.prepare('SELECT token,expires FROM leases WHERE name=?').get('sponsor');
    if (!lease || lease.token !== token || Number(lease.expires) <= Date.now()) throw new MissionError('The payment preparation expired. Retry your saved claim.', 409);
    const r = read(db, actor); fn(r); r.updatedAt = Date.now();
    db.prepare('INSERT OR REPLACE INTO missions VALUES(?,?)').run(subject(actor), JSON.stringify(r));
    return r;
  });
}
export function releaseSponsor(token: string) { database(db => db.prepare('DELETE FROM leases WHERE name=? AND token=?').run('sponsor', token)); }
export function paymentOutboxes(): string[] {
  return database(db => [...db.prepare('SELECT payload FROM missions').all(), ...history(db)].flatMap(row => {
    const r = JSON.parse(String(row.payload)) as MissionRecord;
    return [r.claim?.signedTx, r.fieldNoteClaim?.signedTx].filter((tx): tx is string => !!tx);
  }));
}
/** Separate locks and budget for practice funding; never touches bounty reservations. */
export function acquireSetup(actor: string, sponsor = false) {
  return database(db => {
    const name = sponsor ? 'practice-sponsor' : `deposit:${subject(actor)}`;
    if (sponsor) {
      const rows = [...db.prepare('SELECT actor,payload FROM missions').all(),...history(db)];
      const current=read(db,actor), target=practiceRecord(current);
      if (!current.practiceGrant && rows.some(row=>{
        const previous=JSON.parse(String(row.payload)) as MissionRecord, practice=practiceRecord(previous);
        return !!previous.practiceGrant && (!!target.accountId && practice.accountId===target.accountId || !!target.walletKey && practice.walletKey===target.walletKey || !!target.wallet && practice.wallet===target.wallet);
      })) throw new MissionError('This wallet already received its starter grant. Use its existing test ADA or Strike balance.',409);
      if (rows.some(row => row.actor !== subject(actor) && JSON.parse(String(row.payload)).practiceGrant?.status === 'submitted')) throw new MissionError('Another practice grant is confirming. Try again shortly.', 409);
      if (!read(db, actor).practiceGrant && rows.filter(row => JSON.parse(String(row.payload)).practiceGrant).length >= 20) throw new MissionError('This practice campaign has reached its 20-grant limit.', 409);
    }
    const lease = db.prepare('SELECT expires FROM leases WHERE name=?').get(name);
    if (lease && Number(lease.expires) > Date.now()) throw new MissionError('This setup request is already running. Check again shortly.', 409);
    const token = randomUUID();
    db.prepare('INSERT OR REPLACE INTO leases VALUES(?,?,?)').run(name, token, Date.now() + 180_000);
    return { name, token };
  });
}
export function saveSetup(actor: string, lease: {name: string; token: string}, fn: (r: MissionRecord) => void) {
  return database(db => {
    const row = db.prepare('SELECT token,expires FROM leases WHERE name=?').get(lease.name);
    if (!row || row.token !== lease.token || Number(row.expires) <= Date.now()) throw new MissionError('Setup took too long. Reload your saved step.', 409);
    const r = read(db, actor); fn(r); r.updatedAt = Date.now();
    db.prepare('INSERT OR REPLACE INTO missions VALUES(?,?)').run(subject(actor), JSON.stringify(r));
    return r;
  });
}
export function releaseSetup(lease: {name: string; token: string}) { database(db => db.prepare('DELETE FROM leases WHERE name=? AND token=?').run(lease.name, lease.token)); }
/** Serialize all mission order work for a Strike account, including alternate DRMZ logins. */
export function acquirePosition(actor:string) {
  return database(db=>{
    const r=workshopRecord(read(db,actor));
    if(!r.accountId) throw new MissionError('Connect your funded Strike testnet account first.');
    const name=`position:${r.accountId}`, existing=db.prepare('SELECT expires FROM leases WHERE name=?').get(name);
    if(existing && Number(existing.expires)>Date.now()) throw new MissionError('A request for this Strike account is running. Check again shortly.',409);
    for(const row of [...db.prepare('SELECT actor,payload FROM missions WHERE actor<>?').all(subject(actor)),...history(db)]) {
      const other=JSON.parse(String(row.payload)) as MissionRecord;
      if(Object.values(other.positions || {}).some(p=>p.accountId===r.accountId && p.entry?.sentAt && !p.completedAt)) throw new MissionError('This Strike account has an unfinished mission under another saved practice. Resume that practice before opening a new position.',409);
    }
    const token=randomUUID();db.prepare('INSERT OR REPLACE INTO leases VALUES(?,?,?)').run(name,token,Date.now()+180_000);
    return {name,token};
  });
}
/** Public program accounting only. Never expose account identifiers, notes or signed transactions. */
export function campaignStats() {
  return database(db => {
    const active = db.prepare('SELECT payload FROM missions').all().map(row => JSON.parse(String(row.payload)) as MissionRecord);
    const records = [...active,...history(db).map(row=>JSON.parse(String(row.payload)) as MissionRecord)];
    const paid = records.filter(r => r.claim?.status === 'confirmed');
    const bonuses = records.filter(r => r.fieldNoteClaim?.status === 'confirmed');
    const payments = records.flatMap(r => [{claim:r.claim,amount:REWARD},{claim:r.fieldNoteClaim,amount:FIELD_NOTE_REWARD}]).filter(p => p.claim?.status === 'confirmed');
    return {
      enrolled: active.filter(r => r.blockscholar).length,
      lessonPasses: active.filter(r => r.lessonAt).length,
      verifiedMissions: records.filter(r => r.completedAt).length,
      fieldNotes: active.filter(r => r.blockscholar?.reflection).length,
      claimsStarted: records.filter(r => r.claim).length,
      claimsPending: records.filter(r => r.claim && r.claim.status !== 'confirmed').length,
      claimsPaid: paid.length,
      fieldNoteClaimsStarted: records.filter(r => r.fieldNoteClaim).length,
      fieldNoteClaimsPending: records.filter(r => r.fieldNoteClaim && r.fieldNoteClaim.status !== 'confirmed').length,
      fieldNoteClaimsPaid: bonuses.length,
      fieldNoteUnpaid: records.filter(r => r.completedAt && r.blockscholar?.reflection && r.fieldNoteClaim?.status !== 'confirmed').length,
      verifiedUnpaid: records.filter(r => r.completedAt && r.claim?.status !== 'confirmed').length,
      feesPaidLovelace: payments.reduce((sum, p) => sum + (p.claim?.fee || 0), 0),
      payments: payments.filter(p => /^[a-f0-9]{64}$/.test(p.claim?.txHash || '')).sort((a, b) => (b.claim?.confirmedAt || 0) - (a.claim?.confirmedAt || 0)).slice(0, 40).map(p => ({ txHash: p.claim!.txHash!, confirmedAt: p.claim!.confirmedAt || null, amountLovelace:p.amount })),
    };
  });
}
export function rateLimit(actor: string) {
  database(db => {
    const now = Date.now(), id = subject(actor);
    db.prepare('DELETE FROM limits WHERE expires<?').run(now);
    const row = db.prepare('SELECT count,expires FROM limits WHERE actor=?').get(id);
    if (row && Number(row.count) >= 40) throw new MissionError('Too many mission requests. Please wait a few minutes; your record is saved.', 429);
    db.prepare('INSERT OR REPLACE INTO limits VALUES(?,?,?)').run(id, Number(row?.count || 0) + 1, Number(row?.expires || now + 300_000));
  });
}
