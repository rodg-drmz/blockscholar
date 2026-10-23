import { z } from 'zod';
import { MissionError, type MissionRecord } from './model';

export const STRIKE_TESTNET_API = 'https://api-v2-testnet.strikefinance.org';
export const STRIKE_TESTNET_APP = 'https://testnet.strikefinance.org';
async function request(path: string, query: Record<string, string>) {
  try {
    const response = await fetch(`${STRIKE_TESTNET_API}${path}?${new URLSearchParams(query)}`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (response.status === 404) throw new MissionError('Strike testnet has not found that account or order yet. Check the wallet and order ID.');
    if (!response.ok) throw new MissionError('Strike testnet is unavailable. Your saved progress is unchanged.', 503);
    // Preserve int64 order IDs instead of rounding them through a JS number.
    const text = await response.text();
    return JSON.parse(text.replace(/("ID"\s*:\s*)(\d+)(?=\s*[,}])/g, '$1"$2"'));
  } catch (e) { if (e instanceof MissionError) throw e; throw new MissionError('Could not reach Strike testnet. Please retry.', 503); }
}
const accountSchema = z.object({ account_id: z.string().uuid(), blockchain: z.literal('cardano'), blockchain_address: z.string() });
const orderSchema = z.object({
  ID: z.union([z.number().int().safe().positive(), z.string().regex(/^[1-9][0-9]*$/)]).transform(String),
  AccountID: z.string().uuid(), Symbol: z.literal('ETH-USD'), Type: z.literal('limit'),
  Status: z.enum(['open', 'canceled']), Side: z.enum(['buy', 'sell']),
  Size: z.string().regex(/^\d+(\.\d+)?$/), Price: z.string().regex(/^\d+(\.\d+)?$/), Filled: z.string().regex(/^0(\.0+)?$/),
  CreateTimestamp: z.number().int().positive(), EventTimestamp: z.number().int().positive(),
});
export type Order = z.infer<typeof orderSchema>;
export async function accountFor(address: string) {
  const parsed = accountSchema.safeParse(await request('/v2/account', { blockchain: 'cardano', blockchain_address: address }));
  if (!parsed.success || parsed.data.blockchain_address !== address) throw new MissionError('No matching Cardano account was found on Strike testnet. Connect this same wallet to Strike testnet first.');
  return parsed.data.account_id;
}
/** Always resolve the linked wallet again; a caller cannot select another account. */
export async function accountFunding(address: string, accountId: string) {
  const parsed = accountSchema.extend({ available_balance: z.string().regex(/^-?\d+(\.\d+)?$/) })
    .safeParse(await request('/v2/account', { blockchain: 'cardano', blockchain_address: address }));
  if (!parsed.success || parsed.data.blockchain_address !== address || parsed.data.account_id !== accountId) {
    throw new MissionError('Strike could not verify this account’s test balance. Your saved mission is unchanged.', 503);
  }
  return { accountId, availableBalance: parsed.data.available_balance, funded: Number(parsed.data.available_balance) > 0, checkedAt: Date.now() };
}
export async function orderFor(address: string, id: string) {
  return request('/v2/order', { symbol: 'ETH-USD', order_id: id, blockchain: 'cardano', blockchain_address: address });
}
export async function orderForClient(address: string, clientId: string) {
  return request('/v2/order', { symbol: 'ETH-USD', client_order_id: clientId, blockchain: 'cardano', blockchain_address: address });
}
/** Strike may pad closed-order decimals. Compare exact values without Number rounding. */
function decimalKey(value: string): string | null {
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const [integer, fraction = ''] = value.split('.');
  const whole = integer.replace(/^0+(?=\d)/, ''), digits = fraction.replace(/0+$/, '');
  return digits ? `${whole}.${digits}` : whole;
}
export function validateOrder(raw: unknown, record: MissionRecord, id: string, phase: 'open' | 'canceled', now = Date.now()): Order {
  const parsed = orderSchema.safeParse(raw);
  if (!parsed.success) throw new MissionError('Use an unfilled ETH-USD limit order. Filled, partial, rejected, market or expired orders do not complete this cancellation exercise.');
  const o = parsed.data;
  if (o.ID !== id || o.AccountID !== record.accountId || o.Status !== phase) throw new MissionError(phase === 'open' ? 'The order must be open and belong to your linked Strike account.' : 'Cancel the saved order on Strike testnet, then check again.');
  if (!record.lessonAt || o.CreateTimestamp < record.lessonAt || o.CreateTimestamp > now + 30_000 || o.EventTimestamp < o.CreateTimestamp || o.EventTimestamp > now + 30_000) throw new MissionError('Create a new order after passing this mission’s lesson. Older orders cannot be reused.');
  if (!(Number(o.Size) > 0 && Number(o.Price) > 0 && Number(o.Size) * Number(o.Price) <= 100)) throw new MissionError('For this exercise, keep the order notional at or below 100 test USD.');
  if (phase === 'canceled') {
    const prior = record.order;
    if (!prior || prior.id !== o.ID || prior.accountId !== o.AccountID || decimalKey(prior.price) !== decimalKey(o.Price) || decimalKey(prior.size) !== decimalKey(o.Size) || prior.side !== o.Side || prior.createdAt !== o.CreateTimestamp || o.EventTimestamp < prior.observedAt - 30_000) throw new MissionError('The canceled order does not match your saved open-order checkpoint.');
  }
  return o;
}
