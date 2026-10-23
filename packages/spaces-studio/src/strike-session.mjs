import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { bech32 } from '@scure/base';
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const utf8 = text => new TextEncoder().encode(text);
/** A wallet may rotate its change address after spending. Reconnect the saved
 * identity; CIP-8 signing and server verification still prove ownership. */
export async function connectionAddress(api, purpose, record) {
  const saved = purpose === 'practice'
    ? record?.practiceConnection?.wallet || (record?.wallet?.startsWith('addr_test1') ? record.wallet : null)
    : purpose === 'builder' ? record?.wallet : purpose === 'reward' ? record?.rewardAddress : null;
  return saved || api.getChangeAddress();
}
const addressBytes = value => {
  if (typeof value !== 'string') return null;
  try { return /^[a-f0-9]+$/i.test(value) ? Uint8Array.from(value.match(/../g), byte => parseInt(byte,16)) : bech32.fromWords(bech32.decode(value,1000).words); }
  catch { return null; }
};
/** Read-only diagnostic. Address lists are hints, never a substitute for ownership signing. */
export async function inspectWalletAccount(api, savedAddress) {
  const reads = await Promise.allSettled(['getChangeAddress','getUsedAddresses','getUnusedAddresses','getRewardAddresses'].map(method =>
    walletRequest('address', () => typeof api[method] === 'function' ? api[method]() : Promise.reject(new Error('Unavailable')), 5000)));
  const bytes = reads.map(read => read.status === 'fulfilled' ? (Array.isArray(read.value) ? read.value : [read.value]).map(addressBytes).filter(Boolean) : []);
  const saved = addressBytes(savedAddress), current = bytes[0][0];
  const stake = addr => addr?.length === 57 && (addr[0] >> 4) <= 3 ? hex(addr.slice(29)) : addr?.length === 29 && (addr[0] >> 4) === 14 ? hex(addr.slice(1)) : null;
  const rewards = bytes.flat().map(stake).filter(Boolean), savedStake = stake(saved);
  return {
    currentAddress: current ? bech32.encode((current[0] & 15) === 1 ? 'addr' : 'addr_test',bech32.toWords(current),1000) : null,
    savedAddressListed: saved ? bytes.slice(0,3).flat().some(addr => hex(addr) === hex(saved)) : null,
    sameStakeKey: savedStake && rewards.length ? rewards.includes(savedStake) : null,
    currentAddressMatches: saved && current ? hex(saved) === hex(current) : null,
    unavailableReads: reads.filter(read => read.status === 'rejected').length,
  };
}
export function assertWalletAccount(details, savedAddress) {
  // An omitted/failed address list is inconclusive. Never silently select another identity.
  if (details.currentAddress && details.savedAddressListed === false && details.sameStakeKey === false && details.unavailableReads === 0) {
    const short = address => `${address.slice(0,20)}…${address.slice(-8)}`;
    throw new Error(`The connected wallet account does not match your funded Strike account. Connected: ${short(details.currentAddress)}. Funded: ${short(savedAddress)}. Select the account used for your deposit, or its original wallet app, then reconnect. No signature was requested; your deposit and progress are saved.`);
  }
}
/** CIP-30 can reject with a plain {code, info} object rather than Error.
 * Keep upstream payloads out of the UI and identify the failed operation. */
export async function walletRequest(step, operation, timeoutMs = step === 'sign' ? 120_000 : 30_000) {
  let timer;
  const labels = {enable:'connection', network:'network check', address:'address lookup', sign:'message approval'};
  const label = labels[step] || 'request';
  const timeout = new Error(`Wallet ${label} timed out. Open VESPR and dismiss any old pending request before reconnecting. Your deposit and saved order are unchanged.`);
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(timeout), timeoutMs); }),
    ]);
  } catch (error) {
    if (error === timeout) throw error;
    const code = Number(error?.code);
    if (step === 'sign' && code === 2) throw new Error('This wallet cannot sign for the saved practice address. Use the wallet account that funded this Strike account. Your deposit remains saved.');
    if (step === 'sign' && code === 1) throw new Error('The wallet could not generate the ownership signature. Unlock it and check that the funded practice account is selected, then reconnect. Your deposit remains saved.');
    if (step === 'sign' && code === 3) throw new Error('The wallet returned signature rejection (code 3). DRMZ received no signature. If you approved it, this needs wallet-side diagnosis; your deposit and saved order are unchanged.');
    if (code === -3) throw new Error(`The wallet refused access during ${label} (code -3). Its connection permission may have expired or been disconnected. No signature reached DRMZ; your deposit and saved order are unchanged.`);
    if (code === -4) throw new Error('The wallet account changed during connection. Select the funded practice account and reconnect. Your deposit remains saved.');
    throw new Error(`Wallet ${label} failed${Number.isInteger(code) ? ` (code ${code})` : ''}. Unlock the wallet and retry. Your deposit and saved order are unchanged.`);
  } finally { clearTimeout(timer); }
}
/** Keep this object in a React ref only. Never put this key in storage, URLs or server requests. */
export function newStrikeSession() {
  const privateKey = ed25519.utils.randomPrivateKey();
  return { privateKey, publicKey: hex(ed25519.getPublicKey(privateKey)) };
}
export function signTestOrder(session, operation, body, serverTime, nonce = crypto.randomUUID()) {
  if (!['place', 'cancel'].includes(operation)) throw new Error('Unsupported mission operation.');
  const method = operation === 'place' ? 'POST' : 'DELETE';
  const path = operation === 'place' ? '/v2/order' : '/v2/order/cancel';
  const timestamp = String(Math.floor((serverTime - 1000) / 1000));
  const message = `${method}:${path}:${timestamp}:${nonce}:${hex(sha256(utf8(body)))}`;
  return { 'X-API-Wallet-Public-Key': session.publicKey, 'X-API-Wallet-Signature': hex(ed25519.sign(utf8(message), session.privateKey)), 'X-API-Wallet-Timestamp': timestamp, 'X-API-Wallet-Nonce': nonce };
}

export function signDepositRequest(session, plan, nonce = crypto.randomUUID()) {
  const paths = {quote: '/v2/deposit/quote', build: '/v2/deposit/build-tx', confirm: '/v2/deposit'};
  if (!paths[plan.operation] || plan.path !== paths[plan.operation] || plan.publicKey !== session.publicKey) throw new Error('Unexpected deposit request.');
  const timestamp = String(Math.floor((plan.serverTime - 1000) / 1000));
  const message = `POST:${plan.path}:${timestamp}:${nonce}:${hex(sha256(utf8(plan.body)))}`;
  return {'X-API-Wallet-Public-Key':session.publicKey, 'X-API-Wallet-Signature':hex(ed25519.sign(utf8(message), session.privateKey)), 'X-API-Wallet-Timestamp':timestamp, 'X-API-Wallet-Nonce':nonce};
}
