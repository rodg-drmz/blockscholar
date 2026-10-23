import { randomUUID, createHash } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519';
import { z } from 'zod';
import * as CSL from '@emurgo/cardano-serialization-lib-nodejs';
import { paymentIdentity, verifyBadgeWalletSignature } from '../auth/cardano-proof';
import { MissionError, actionSchema, practiceRecord, workshopRecord } from './model';
import { getRecord, updateRecord } from './store';
import { accountFor, accountFunding, orderForClient, STRIKE_TESTNET_API } from './strike';

import { saveVerifiedCancellation } from './cancellation';

async function reconcileCancellation(actor: string, record: ReturnType<typeof workshopRecord>) {
  const raw = await orderForClient(record.wallet!, record.trade!.clientId);
  if (String(raw?.ID) !== record.order?.id || raw.AccountID !== record.accountId || raw.ClientOrderID !== record.trade!.clientId) throw new MissionError('Strike returned a different order. Your saved checkpoint is unchanged.', 503);
  if (raw.Status !== 'canceled') return null;
  saveVerifiedCancellation(actor, raw);
  return { notice: 'Cancellation verified. Your order had zero fills and your completion is saved.' };
}

export function builderCode() { const code = process.env.STRIKE_MISSIONS_BUILDER_CODE || ''; return /^[a-zA-Z0-9_-]{1,80}$/.test(code) ? code : null; }
export async function testnetRequest(path: string, init?: RequestInit) {
  let response;
  try { response = await fetch(`${STRIKE_TESTNET_API}${path}`, { ...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) }); }
  catch { throw new MissionError('Could not reach Strike testnet. Your DRMZ sign-in and mission progress are saved. Retry when connected.', 503); }
  const raw = await response.text(); let data;
  try { data = JSON.parse(raw.replace(/("ID"\s*:\s*)(\d+)(?=\s*[,}])/g, '$1"$2"')); } catch { throw new MissionError('Strike returned an unreadable response. Your saved mission is unchanged.', 503); }
  return { ok: response.ok, status: response.status, data };
}
export function builderFailure(status: number, data: unknown): string {
  const error = typeof data === 'object' && data !== null && 'error' in data ? String(data.error) : '';
  if (status === 404 && error === 'builder code not found') return 'This builder code is not registered on Strike testnet. Register it at testnet.strikefinance.org/builder-codes; a mainnet code does not enable this mission.';
  if (error === 'builder is not active') return 'Strike reports this testnet builder code is inactive. Ask Strike to activate it before retrying.';
  if (status === 429) return 'Strike is receiving too many connection requests. Wait a moment, then retry. Your saved progress is unchanged.';
  if (error === 'challenge not found or expired') return 'Strike’s wallet request expired. Connect again and approve the new message within five minutes.';
  if (error === 'wallet signature verification failed') return 'Strike could not verify the wallet message. Reconnect with the same Cardano wallet and approve the fresh request.';
  return 'Strike testnet could not complete the connection. Retry with a new wallet request; your saved progress is unchanged.';
}
export async function tradeClock() {
  const r = await testnetRequest('/v2/time');
  if (!r.ok || !Number.isSafeInteger(r.data.serverTime)) throw new MissionError('Strike’s testnet clock is temporarily unavailable.', 503);
  return { serverTime: r.data.serverTime };
}
const SCALE = 100_000_000n;
const decimal = (v: string) => {
  if (!/^\d+(\.\d{1,8})?$/.test(v)) throw new MissionError('Strike market precision is unsupported by this mission.', 503);
  const [whole, fraction = ''] = v.split('.'); return BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, '0'));
};
const format = (n: bigint) => `${n / SCALE}.${String(n % SCALE).padStart(8, '0')}`.replace(/\.?0+$/, '');
export function planOrder(m: Record<string, string>, clientId: string) {
  if (m.status !== 'trading' || (m as unknown as { reduce_only: boolean }).reduce_only) throw new MissionError('This testnet market is not accepting practice orders.');
  const mark = decimal(m.mark_price), minPrice = decimal(m.order_min_price), tick = decimal(m.order_tick_price), bound = decimal(m.order_limit_price_bound);
  const step = decimal(m.order_limit_step_size), origin = decimal(m.order_limit_min_size), minimum = decimal(m.order_market_min_size), max = decimal(m.order_limit_max_size), minNotional = decimal(m.order_min_notional);
  if (mark <= 0n || tick <= 0n || step <= 0n || bound <= 0n) throw new MissionError('Strike testnet market rules are not ready.', 503);
  const offset = bound / 2n < SCALE / 100n ? bound / 2n : SCALE / 100n;
  const target = mark * (SCALE - offset) / SCALE;
  if (target < minPrice) throw new MissionError('Strike reports incompatible testnet price limits. Retry once its market configuration is corrected.', 503);
  const price = minPrice + (target - minPrice) / tick * tick;
  if (price < mark * (SCALE - bound) / SCALE || price <= 0n || (decimal(m.order_max_price) > 0n && price > decimal(m.order_max_price))) throw new MissionError('No valid resting practice price is available.', 503);
  const targetNotional = minNotional * 11n / 10n;
  const needed = (targetNotional * SCALE + price - 1n) / price;
  const baseline = needed > minimum ? needed : minimum;
  const size = baseline <= origin ? origin : origin + (baseline - origin + step - 1n) / step * step;
  if (size > max || size * price > 100n * SCALE * SCALE) throw new MissionError('The market minimum exceeds this mission’s 100 test-USD limit.', 503);
  const body = JSON.stringify({ symbol: 'ETH-USD', side: 'buy', type: 'limit', size: format(size), price: format(price), post_only: true, time_in_force: 'GTC', client_order_id: clientId });
  return { body, price: format(price), size: format(size) };
}
type Action = z.infer<typeof actionSchema>;
export async function tradingAction(actor: string, a: Action, origin: string): Promise<Record<string, unknown>> {
  const code = builderCode(), stored = getRecord(actor), r = workshopRecord(stored);
  if (!code) throw new MissionError('DRMZ needs an active Strike testnet builder code before in-app setup and trading can open.', 503);
  if (!r.lessonAt && !['builder-challenge', 'builder-connect'].includes(a.type)) throw new MissionError('Pass the lesson checks first.');
  if (a.type === 'builder-challenge') {
    let identity, network: 'mainnet' | 'preprod';
    try { const addr = /^[a-f0-9]+$/i.test(a.address) ? CSL.Address.from_hex(a.address) : CSL.Address.from_bech32(a.address); network = addr.network_id() === 1 ? 'mainnet' : 'preprod'; identity = paymentIdentity(addr.to_bech32(), network); }
    catch { throw new MissionError('Connect a Cardano payment-key wallet.'); }
    const target = a.context === 'practice' ? practiceRecord(stored) : r;
    const context = a.context === 'practice' || stored.practiceConnection?.accountId === target.accountId ? 'practice' : undefined;
    const separatePractice = a.context === 'practice' && !stored.practiceConnection && !!stored.wallet && CSL.Address.from_bech32(stored.wallet).network_id() === 1;
    if ((a.context === 'practice' || !r.wallet) && network !== 'preprod') throw new MissionError('Switch your Cardano wallet to Preprod for this testnet lesson.');
    if (!separatePractice && target.wallet && target.wallet !== identity.address) {
      const short = (address: string) => `${address.slice(0, 16)}…${address.slice(-8)}`;
      throw new MissionError(`Use the Cardano wallet already linked to this mission. Connected: ${short(identity.address)}. Funded practice wallet: ${short(target.wallet)}. ${target.walletKey === identity.ownerKeyHash ? 'The payment key matches but the address changed; DRMZ needs to reconcile the account link.' : 'Select the matching account in your wallet, keep it on Preprod, then reconnect.'}`);
    }
    const response = await testnetRequest('/auth/builder/request-signature', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: identity.address, chain: 'cardano', code, fee_share_bps: 0, public_key: a.publicKey }) });
    const parsed = z.object({ nonce: z.string().min(1).max(200), message_to_sign: z.string().min(1).max(6000) }).safeParse(response.data);
    if (!response.ok) throw new MissionError(builderFailure(response.status, response.data), 503);
    if (!parsed.success) throw new MissionError('Strike returned an unexpected connection request. No wallet approval was requested. DRMZ needs to check the testnet API.', 503);
    const { nonce, message_to_sign: message } = parsed.data;
    updateRecord(actor, latest => { latest.builderChallenge = { context, nonce, message, address: identity.address, key: identity.ownerKeyHash, network, publicKey: a.publicKey, expires: Date.now() + 240_000, origin }; });
    return { challenge: { message, hex: Buffer.from(message).toString('hex'), addressHex: identity.addressHex } };
  }
  if (a.type === 'builder-connect') {
    const c = r.builderChallenge;
    if (!c || c.expires < Date.now() || c.origin !== origin) throw new MissionError('Strike’s connection request expired. Connect again.');
    updateRecord(actor, latest => { if (latest.builderChallenge?.nonce !== c.nonce) throw new MissionError('Connection request changed.'); delete latest.builderChallenge; });
    if (!await verifyBadgeWalletSignature(c.address, Buffer.from(c.message).toString('hex'), a.proof, c.network)) throw new MissionError('The signature did not match your Strike connection request.');
    const response = await testnetRequest('/auth/builder/verify-signature', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nonce: c.nonce, wallet_signature: JSON.stringify(a.proof) }) });
    const parsed = z.object({ account_id: z.string().uuid(), api_wallet_public_key: z.literal(c.publicKey), builder_code: z.literal(code), fee_share_bps: z.literal(0) }).safeParse(response.data);
    if (!response.ok) throw new MissionError(builderFailure(response.status, response.data), 503);
    if (!parsed.success) throw new MissionError('Strike did not confirm the expected account, builder, and zero-fee permission. Reconnect with a new session key.');
    if (await accountFor(c.address) !== parsed.data.account_id) throw new MissionError('Strike’s account lookup did not match the connection.');
    updateRecord(actor, (latest, bind) => {
      const independent = c.context === 'practice' && (latest.practiceConnection || latest.wallet && CSL.Address.from_bech32(latest.wallet).network_id() === 1);
      if (independent) {
        if (c.network !== 'preprod') throw new MissionError('Practice funding requires Preprod.');
        if (latest.practiceConnection && (latest.practiceConnection.wallet !== c.address || latest.practiceConnection.accountId !== parsed.data.account_id)) throw new MissionError('Use the Preprod wallet already linked to this practice deposit.');
        if (!latest.practiceConnection && (latest.practiceGrant || latest.deposit)) throw new MissionError('An existing funding record must be reconciled before changing its wallet.', 409);
        bind('wallet', c.key); bind('account', parsed.data.account_id);
        latest.practiceConnection = {wallet: c.address, walletKey: c.key, accountId: parsed.data.account_id, apiPublicKey: c.publicKey};
      } else {
        if (latest.accountId && latest.accountId !== parsed.data.account_id) throw new MissionError('This mission is linked to another Strike account.');
        if (latest.wallet && latest.wallet !== c.address) throw new MissionError('The linked wallet changed. Reconnect it.');
        bind('wallet', c.key); bind('account', parsed.data.account_id);
        latest.accountId = parsed.data.account_id; latest.wallet = c.address; latest.walletKey = c.key; latest.apiPublicKey = c.publicKey;
      }
    });
    return {};
  }
  if (!r.accountId || !r.wallet || !r.apiPublicKey) throw new MissionError('Connect Strike testnet in this mission first.');
  if (a.type === 'trade-clock') return tradeClock();
  if (a.type === 'order-prepare') {
    if (r.completedAt) throw new MissionError('This mission is already complete.');
    if (r.trade && r.trade.status !== 'rejected') return {};
    const funding = await accountFunding(r.wallet, r.accountId);
    if (!funding.funded) throw new MissionError('Your Strike test account has no available trading credits. Fund it on Strike testnet, then check again. Preprod bounty ADA is separate; do not deposit real funds.');
    const response = await testnetRequest('/v2/markets');
    if (!response.ok || !response.data.markets?.['ETH-USD']) throw new MissionError('Strike market rules are unavailable.', 503);
    const clientId = `drmz-${randomUUID()}`;
    const plan = planOrder(response.data.markets['ETH-USD'], clientId);
    updateRecord(actor, latest => {
      if (latest.trade && latest.trade.status !== 'rejected') return;
      if (workshopRecord(latest).accountId !== r.accountId) throw new MissionError('The workshop account changed. Reconnect before preparing an order.', 409);
      latest.workshopAccountId = r.accountId;
      latest.trade = { clientId, ...plan, status: 'draft' };
    });
    return {};
  }
  if (a.type === 'trade-submit') {
    if (a.operation === 'cancel' && r.completedAt) return { notice: 'Cancellation already verified. Your completion is saved.' };
    if (!r.trade || r.completedAt) throw new MissionError('Prepare a test order before submitting.');
    if (a.headers['X-API-Wallet-Public-Key'] !== r.apiPublicKey) throw new MissionError('Reconnect Strike in this browser to use its current session key.');
    if (a.operation === 'place' && r.trade.status !== 'draft') throw new MissionError('This order was already sent. Check its status; it will not be placed twice.', 409);
    if (a.operation === 'cancel' && (!r.order || r.trade.status !== 'sent' || r.order.clientId !== r.trade.clientId)) throw new MissionError('Check this mission order to save its open checkpoint before canceling.');
    const method = a.operation === 'place' ? 'POST' : 'DELETE';
    const route = a.operation === 'place' ? '/v2/order' : '/v2/order/cancel';
    const body = a.operation === 'place' ? r.trade.body : JSON.stringify({ symbol: 'ETH-USD', client_order_id: r.trade.clientId });
    const message = `${method}:${route}:${a.headers['X-API-Wallet-Timestamp']}:${a.headers['X-API-Wallet-Nonce']}:${createHash('sha256').update(body).digest('hex')}`;
    if (!ed25519.verify(Buffer.from(a.headers['X-API-Wallet-Signature'], 'hex'), Buffer.from(message), Buffer.from(r.apiPublicKey, 'hex'))) throw new MissionError('The signed order did not match the reviewed mission request.');
    if (a.operation === 'place') updateRecord(actor, latest => {
      if (latest.trade?.body !== body || latest.trade.status !== 'draft') throw new MissionError('This order was already sent. Check its status.', 409);
      latest.trade.status = 'sent'; latest.trade.sentAt = Date.now();
    });
    if (a.operation === 'cancel') {
      const settled = await reconcileCancellation(actor, r);
      if (settled) return settled;
    }
    let response;
    try { response = await testnetRequest(route, { method, headers: { ...a.headers, 'content-type': 'application/json', 'X-Builder-Fee-Bps': '0' }, body }); }
    catch {
      if (a.operation === 'cancel') {
        const settled = await reconcileCancellation(actor, r).catch(() => null);
        if (settled) return settled;
      }
      throw new MissionError('Strike’s response was interrupted. Check the saved order status; do not submit another order.', 503);
    }
    if (!response.ok) {
      if (a.operation === 'cancel') {
        const settled = await reconcileCancellation(actor, r).catch(() => null);
        if (settled) return settled;
        throw new MissionError([401, 403].includes(response.status) ? 'Strike rejected this trading authorization. Check the order status first; authorize Strike again only if the order is still open.' : 'Strike did not confirm cancellation. Check the saved order status before trying again. No new deposit is needed.', 503);
      }
      // A gateway timeout does not tell us whether the sequencer accepted the order.
      if (a.operation === 'place' && [400, 401, 403, 404, 422, 429].includes(response.status)) updateRecord(actor, latest => { if (latest.trade?.clientId === r.trade!.clientId) latest.trade.status = 'rejected'; });
      throw new MissionError('Strike has not accepted the request. Check the account’s test balance, session key, and order status. No real-fund deposit is needed for this mission.');
    }
    if (a.operation === 'cancel') {
      const settled = await reconcileCancellation(actor, r).catch(() => null);
      if (settled) return settled;
    }
    return { notice: a.operation === 'place' ? 'Order request sent. Check its status to save the open-order checkpoint.' : 'Cancellation requested. Check its status to verify completion.' };
  }
  throw new MissionError('Unknown trading action.');
}
