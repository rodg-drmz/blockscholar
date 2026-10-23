import { z } from 'zod';

export const MISSION = 'strike-limit-lab-v1';
export const REWARD = 2_000_000;
export const FIELD_NOTE_REWARD = 3_000_000;
export type ClaimKind = 'claim' | 'fieldNoteClaim';
export type BountyClaim = { id: string; status: 'reserved' | 'submitted' | 'confirmed'; txHash?: string; signedTx?: string; expiresSlot?: number; fee?: number; confirmedAt?: number };
export const MAX_CLAIMS = 20;
export const PRACTICE_GRANT = 104_000_000;
export const DEPOSIT_AMOUNT = '100000000';
export type TestPayment = { status: 'submitted' | 'confirmed'; txHash: string; signedTx?: string; expiresSlot: number; fee: number; confirmedAt?: number; grantAmount?: number };
export type PracticeDeposit = {
  requestId: string; accountId: string; address: string; amount: string; usdValue: string; expires: number; confirmations: number;
  status: 'quoted' | 'built' | 'submitted' | 'registered' | 'verified';
  paymentAddress?: string; paymentAmount?: string; batcherFee?: number; routeAuthority?: 'strike-testnet-api' | 'quoted-vault';
  unsignedTx?: string; signedTx?: string; txHash?: string; fee?: number; expiresSlot?: number; verifiedAt?: number; creditedUsd?: string;
  chainConfirmedAt?: number;
  inputKeys?: string[];
  settlementStatus?: 'pending' | 'pending_settlement' | 'failed' | 'cancelled';
};
export class MissionError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export type Direction = 'long' | 'short';
export type PositionRequest = {clientId:string; body:string; size:string; estimate:string; expires:number; status:'draft'|'sent'|'terminal'; sentAt?:number; orderId?:string; filled?:string; outcome?:string; closeReason?:string};
export type PositionMission = {version:1; direction:Direction; accountId:string; wallet:string; scenarioAt:number; entry?:PositionRequest; exits:PositionRequest[]; retired?:PositionRequest[]; open?:{size:string; entryPrice:string; observedAt:number}; entryLiquidity?:{checkedAt:number; size:string; status:'ready'|'paused'|'unavailable'; reason?:string}; closeBook?:{checkedAt:number; size:string; bestPrice?:string}; completedAt?:number; receipt?:string};
export type MissionRecord = {
  id: string; startedAt: number; updatedAt: number; lessonAt?: number;
  blockscholar?: { enrolledAt: number; reflection?: { learning: string; application: string; artifactUrl: string; savedAt: number } };
  wallet?: string; walletKey?: string; accountId?: string;
  order?: { id: string; accountId: string; price: string; size: string; side: string; createdAt: number; observedAt: number; clientId?: string };
  completedAt?: number; receipt?: string;
  challenge?: { purpose: 'strike' | 'reward'; address: string; network: 'mainnet' | 'preprod'; key: string; hex: string; origin: string; expires: number };
  rewardAddress?: string; rewardKey?: string;
  builderChallenge?: { context?: 'practice'; nonce: string; message: string; publicKey: string; address: string; key: string; network: 'mainnet' | 'preprod'; expires: number; origin: string };
  apiPublicKey?: string;
  practiceConnection?: { wallet: string; walletKey: string; accountId: string; apiPublicKey: string };
  workshopAccountId?: string;
  practiceExistingAt?: number;
  positions?: Partial<Record<Direction,PositionMission>>;
  practiceGrant?: TestPayment;
  deposit?: PracticeDeposit;
  depositRequest?: { operation: 'quote' | 'build' | 'confirm'; body: string; expires: number; id: string; publicKey: string; walletUtxos?: string[] };
  trade?: { clientId: string; body: string; price: string; size: string; status: 'draft' | 'sent' | 'rejected'; sentAt?: number };
  claim?: BountyClaim;
  fieldNoteClaim?: BountyClaim;
};

// Only this server module contains the grading key. Public questions are returned separately.
const questions = [
  { id: 'limit', prompt: 'What does a buy limit order control?', choices: ['The highest price you will pay, if it fills', 'A guaranteed profit', 'The time at which it must fill'], answer: 0 },
  { id: 'cancel', prompt: 'Why inspect Open Orders before canceling?', choices: ['Cancellation reverses any fills', 'To check whether any quantity already filled', 'An order ID guarantees the order is still open'], answer: 1 },
  { id: 'post-only', prompt: 'What does post-only mean for a Strike limit order?', choices: ['The order can never fill', 'The order must fill immediately', 'It avoids immediate taker execution; a resting order can still fill later'], answer: 2 },
];
export const publicQuestions = questions.map(q => ({ id: q.id, prompt: q.prompt, choices: q.choices }));
export function grade(answers: number[]) {
  if (answers.length !== questions.length || answers.some((v, i) => v !== questions[i].answer)) throw new MissionError('Review the lesson and try again. Answer all three workshop questions correctly.');
}
export const actionSchema = z.discriminatedUnion('type', [
  z.object({type:z.literal('position-scenario'),direction:z.enum(['long','short']),answers:z.array(z.number().int().min(0).max(2)).length(2)}).strict(),
  z.object({type:z.literal('position-prepare'),direction:z.enum(['long','short']),operation:z.enum(['entry','exit'])}).strict(),
  z.object({type:z.literal('position-check'),direction:z.enum(['long','short'])}).strict(),
  z.object({type:z.literal('position-submit'),direction:z.enum(['long','short']),operation:z.enum(['entry','exit']),clientId:z.string().max(100),headers:z.object({
    'X-API-Wallet-Public-Key':z.string().regex(/^[a-f0-9]{64}$/),
    'X-API-Wallet-Signature':z.string().regex(/^[a-f0-9]{128}$/),
    'X-API-Wallet-Timestamp':z.string().regex(/^[0-9]{10,11}$/),
    'X-API-Wallet-Nonce':z.string().min(16).max(128),
  }).strict()}).strict(),
  z.object({ type: z.literal('practice-restart'), expectedUpdatedAt: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('practice-restore'), attemptId: z.string().uuid(), expectedUpdatedAt: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('practice-account-check') }).strict(),
  z.object({ type: z.literal('practice-existing') }).strict(),
  z.object({ type: z.literal('practice-fund') }).strict(),
  z.object({ type: z.literal('practice-check') }).strict(),
  z.object({ type: z.literal('deposit-plan'), operation: z.enum(['quote', 'build', 'confirm']), walletUtxos:z.array(z.string().regex(/^[a-f0-9]+$/i).max(8192)).min(1).max(20).optional() }).strict(),
  z.object({ type: z.literal('deposit-request'), id: z.string().uuid(), headers: z.object({
    'X-API-Wallet-Public-Key': z.string().regex(/^[a-f0-9]{64}$/),
    'X-API-Wallet-Signature': z.string().regex(/^[a-f0-9]{128}$/),
    'X-API-Wallet-Timestamp': z.string().regex(/^[0-9]{10,11}$/),
    'X-API-Wallet-Nonce': z.string().min(16).max(128),
  }).strict() }).strict(),
  z.object({ type: z.literal('deposit-submit'), txHash: z.string().regex(/^[a-f0-9]{64}$/), witnesses: z.string().regex(/^[a-f0-9]+$/i).min(2).max(8192) }).strict(),
  z.object({ type: z.literal('deposit-check') }).strict(),
  z.object({ type: z.literal('program-enroll') }).strict(),
  z.object({ type: z.literal('program-reflection'), learning: z.string().trim().min(30).max(2000), application: z.string().trim().min(30).max(2000), artifactUrl: z.string().max(1000).refine(value => {
    if (!value) return true;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
  }, 'Use an HTTPS link without credentials, or leave it blank.') }).strict(),
  z.object({ type: z.literal('builder-challenge'), context: z.literal('practice').optional(), address: z.string().min(20).max(250), publicKey: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ type: z.literal('builder-connect'), proof: z.object({ key: z.string().max(4096), signature: z.string().max(16384) }).strict() }).strict(),
  z.object({ type: z.literal('order-prepare') }).strict(),
  z.object({ type: z.literal('order-check') }).strict(),
  z.object({ type: z.literal('account-check') }).strict(),
  z.object({ type: z.literal('trade-clock') }).strict(),
  z.object({ type: z.literal('trade-submit'), operation: z.enum(['place', 'cancel']), headers: z.object({
    'X-API-Wallet-Public-Key': z.string().regex(/^[a-f0-9]{64}$/),
    'X-API-Wallet-Signature': z.string().regex(/^[a-f0-9]{128}$/),
    'X-API-Wallet-Timestamp': z.string().regex(/^[0-9]{10,11}$/),
    'X-API-Wallet-Nonce': z.string().min(16).max(128),
  }).strict() }).strict(),
  z.object({ type: z.literal('lesson'), answers: z.array(z.number().int().min(0).max(2)).length(3) }).strict(),
  z.object({ type: z.literal('challenge'), purpose: z.enum(['strike', 'reward']), address: z.string().min(20).max(250) }).strict(),
  z.object({ type: z.literal('link'), proof: z.object({ key: z.string().max(4096), signature: z.string().max(16384) }).strict() }).strict(),
  z.object({ type: z.literal('observe'), orderId: z.string().regex(/^[1-9][0-9]{0,18}$/) }).strict(),
  z.object({ type: z.literal('verify') }).strict(),
  z.object({ type: z.literal('field-note-claim') }).strict(),
  z.object({ type: z.literal('field-note-receipt') }).strict(),
  z.object({ type: z.literal('claim') }).strict(),
  z.object({ type: z.literal('receipt') }).strict(),
]);
export function publicRecord(record: MissionRecord) {
  const safe = structuredClone(record);
  delete safe.challenge; delete safe.builderChallenge; delete safe.walletKey; delete safe.rewardKey;
  delete safe.depositRequest;
  if (safe.practiceConnection) delete (safe.practiceConnection as Partial<NonNullable<MissionRecord['practiceConnection']>>).walletKey;
  if (safe.practiceGrant) delete safe.practiceGrant.signedTx;
  if (safe.deposit) delete safe.deposit.signedTx;
  if (safe.claim) delete safe.claim.signedTx;
  if (safe.fieldNoteClaim) delete safe.fieldNoteClaim.signedTx;
  return safe;
}

export function practiceRecord(record: MissionRecord): MissionRecord {
  return record.practiceConnection ? {...record, ...record.practiceConnection} : record;
}

// New workshops use the account actually funded by the verified deposit. Older
// order evidence and completions keep their original account; never rebind them.
export function workshopRecord(record: MissionRecord): MissionRecord {
  const p = record.practiceConnection;
  if (!p || record.deposit?.status !== 'verified' || record.deposit.accountId !== p.accountId) return record;
  if (record.workshopAccountId === p.accountId) return practiceRecord(record);
  if (record.order || record.trade || record.completedAt || record.claim) return record;
  return practiceRecord(record);
}
