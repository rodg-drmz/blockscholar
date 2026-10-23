import test from 'node:test';
import assert from 'node:assert/strict';
import { walletSignInMessage } from './wallet-sign-in-message';

const fixture = { origin: 'https://drmz.test', chain: 'cardano' as const, address: 'test-address', challenge: 'test-id', nonce: 'test-nonce', expiresAt: Date.UTC(2026, 9, 13, 20) };

test('wallet message leads with clear intent and preserves all signature bindings', () => {
  const message = walletSignInMessage(fixture);
  assert.ok(message.startsWith('Sign in to DRMZ\n\n'));
  assert.match(message, /does not cast a vote, send a transaction, or authorize spending/);
  for (const text of ['Website: https://drmz.test', 'Wallet type: Cardano', 'Wallet address: test-address', 'Request ID: test-id', 'Nonce: test-nonce', 'Expires: 2026-10-13T20:00:00.000Z']) assert.ok(message.includes(text));
  assert.ok(!message.includes('DRMZ Learn'));
});

test('origin, wallet, chain, nonce and expiry changes produce distinct signed text', () => {
  const original = walletSignInMessage(fixture);
  for (const change of [{ origin: 'https://other.test' }, { address: 'other-address' }, { chain: 'solana' as const }, { challenge: 'other-id' }, { nonce: 'other-nonce' }, { expiresAt: fixture.expiresAt + 1 }]) {
    assert.notEqual(walletSignInMessage({ ...fixture, ...change }), original);
  }
});

test('linking a wallet to an existing verified account is disclosed in the signed message', () => {
  assert.match(walletSignInMessage({ ...fixture, linkExistingAccount: true }), /links this wallet to your signed-in DRMZ account/);
  assert.doesNotMatch(walletSignInMessage(fixture), /links this wallet/);
});
