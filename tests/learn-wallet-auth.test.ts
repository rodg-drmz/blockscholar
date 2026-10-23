import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { privateKeyToAccount } from 'viem/accounts';
import { ed25519 } from '@noble/curves/ed25519';
import {
  sampleSigningKey,
  signData,
  signatureVerifyingKey,
  addressFromKey,
} from '@midnight-ntwrk/ledger-v8';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function encodeBase58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) + BigInt(byte);
  let encoded = '';
  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded || '1';
}

test('wallet login consumes challenges and restores the same DID', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'drmz-wallet-auth-'));
  const previous = {
    dataDir: process.env.DRMZ_LEARN_DATA_DIR,
    sessionSecret: process.env.DRMZ_APP_SESSION_SECRET,
    encryption: process.env.DRMZ_LOCAL_DATA_ENCRYPTION_ENABLED,
    requireEncryption: process.env.DRMZ_LOCAL_DATA_REQUIRE_ENCRYPTED,
    resendKey: process.env.RESEND_API_KEY,
    magicFrom: process.env.AUTH_MAGIC_LINK_FROM,
  };
  process.env.DRMZ_LEARN_DATA_DIR = root;
  process.env.DRMZ_APP_SESSION_SECRET =
    'wallet-auth-test-secret-at-least-thirty-two-characters';
  process.env.DRMZ_LOCAL_DATA_ENCRYPTION_ENABLED = 'false';
  process.env.DRMZ_LOCAL_DATA_REQUIRE_ENCRYPTED = 'false';
  delete process.env.RESEND_API_KEY;
  delete process.env.AUTH_MAGIC_LINK_FROM;
  t.after(async () => {
    if (previous.dataDir === undefined) delete process.env.DRMZ_LEARN_DATA_DIR;
    else process.env.DRMZ_LEARN_DATA_DIR = previous.dataDir;
    if (previous.sessionSecret === undefined) delete process.env.DRMZ_APP_SESSION_SECRET;
    else process.env.DRMZ_APP_SESSION_SECRET = previous.sessionSecret;
    if (previous.encryption === undefined) delete process.env.DRMZ_LOCAL_DATA_ENCRYPTION_ENABLED;
    else process.env.DRMZ_LOCAL_DATA_ENCRYPTION_ENABLED = previous.encryption;
    if (previous.requireEncryption === undefined) delete process.env.DRMZ_LOCAL_DATA_REQUIRE_ENCRYPTED;
    else process.env.DRMZ_LOCAL_DATA_REQUIRE_ENCRYPTED = previous.requireEncryption;
    if (previous.resendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous.resendKey;
    if (previous.magicFrom === undefined) delete process.env.AUTH_MAGIC_LINK_FROM;
    else process.env.AUTH_MAGIC_LINK_FROM = previous.magicFrom;
    await rm(root, { recursive: true, force: true });
  });

  const challengeRoute = await import('../app/api/auth/wallet/challenge/route');
  const verifyRoute = await import('../app/api/auth/wallet/verify/route');
  const sessionRoute = await import('../app/api/auth/session/route');
  const account = privateKeyToAccount(
    '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  );

  const begin = async () => {
    const response = await challengeRoute.POST(
      new Request('https://drmz.test/api/auth/wallet/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chain: 'ethereum',
          address: account.address,
          walletName: 'Test wallet',
          network: 'eip155',
        }),
      }),
    );
    assert.equal(response.status, 200);
    return (await response.json()) as {
      challenge: { id: string; message: string };
    };
  };

  const first = await begin();
  assert.ok(first.challenge.message.startsWith('Sign in to DRMZ\n\n'));
  assert.match(first.challenge.message, /Website: https:\/\/drmz.test/);
  assert.match(first.challenge.message, /does not cast a vote, send a transaction, or authorize spending/);
  for (const address of ['address\nWebsite: https://other.test', 'address\u202Ehidden']) {
    const response = await challengeRoute.POST(new Request('https://drmz.test/api/auth/wallet/challenge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chain: 'ethereum', address }),
    }));
    assert.equal(response.status, 400, 'wallet address must not inject lines or bidi controls into the prompt');
  }
  const signature = await account.signMessage({ message: first.challenge.message });
  const verifyRequest = () =>
    new Request('https://drmz.test/api/auth/wallet/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: first.challenge.id,
        proof: { chain: 'ethereum', signature },
      }),
    });
  const verified = await verifyRoute.POST(verifyRequest());
  assert.equal(verified.status, 200);
  const verifiedBody = (await verified.json()) as {
    identity: { id: string; did: string; email: null };
  };
  assert.match(verifiedBody.identity.did, /^did:veridian:[a-f0-9]{32}$/);
  assert.equal(verifiedBody.identity.email, null);

  const cookie = verified.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const session = await sessionRoute.GET(
    new Request('https://drmz.test/api/auth/session', {
      headers: { cookie },
    }),
  );
  const sessionBody = (await session.json()) as {
    authenticated: boolean;
    user: { did: string; email: null };
  };
  assert.equal(sessionBody.authenticated, true);
  assert.equal(sessionBody.user.did, verifiedBody.identity.did);
  assert.equal(sessionBody.user.email, null);

  const replay = await verifyRoute.POST(verifyRequest());
  assert.equal(replay.status, 401);

  const second = await begin();
  const secondResponse = await verifyRoute.POST(
    new Request('https://drmz.test/api/auth/wallet/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengeId: second.challenge.id,
        proof: {
          chain: 'ethereum',
          signature: await account.signMessage({ message: second.challenge.message }),
        },
      }),
    }),
  );
  const secondBody = (await secondResponse.json()) as {
    identity: { id: string; did: string };
  };
  assert.equal(secondBody.identity.id, verifiedBody.identity.id);
  assert.equal(secondBody.identity.did, verifiedBody.identity.did);

  const { redirectWithUser } = await import('../app/api/lib/auth-session');
  const badReturn = redirectWithUser('https://drmz.test', '/\\attacker.example', {id: 'test', name: 'Test', email:'learner@example.edu', provider:'email_link'});
  assert.equal(new URL(badReturn.headers.get('location')!).origin, 'https://drmz.test');

  const magicRoute = await import('../app/api/auth/magic-link/route');
  const magicVerifyRoute = await import('../app/api/auth/magic-link/verify/route');
  const privateReturn = '/learn/blockscholar';
  const missing = await magicVerifyRoute.GET(new NextRequest(`https://drmz.test/api/auth/magic-link/verify?return=${encodeURIComponent(privateReturn)}`));
  assert.equal(new URL(missing.headers.get('location')!).pathname, privateReturn, 'failed sign-in returns to Blockscholar');
  const magic = await magicRoute.POST(
    new NextRequest('http://localhost/api/auth/magic-link', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        email: 'learner@example.edu',
        returnTo: '/learn',
        intent: 'link',
      }),
    }),
  );
  assert.equal(magic.status, 200);
  const magicBody = (await magic.json()) as { devLink?: string };
  assert.ok(magicBody.devLink);
  const emailVerified = await magicVerifyRoute.GET(
    new NextRequest(magicBody.devLink),
  );
  assert.equal(emailVerified.status, 307);
  const linkedCookie = emailVerified.headers.get('set-cookie')?.split(';')[0];
  assert.ok(linkedCookie);
  const linkedSession = await sessionRoute.GET(
    new Request('http://localhost/api/auth/session', {
      headers: { cookie: linkedCookie },
    }),
  );
  const linkedBody = (await linkedSession.json()) as {
    user: { id: string; did: string; email: string };
  };
  assert.equal(linkedBody.user.id, verifiedBody.identity.id);
  assert.equal(linkedBody.user.did, verifiedBody.identity.did);
  assert.equal(linkedBody.user.email, 'learner@example.edu');

  const { resolveEmailAccount } = await import('../lib/auth/learn-identity-store');
  const linked = await resolveEmailAccount('learner@example.edu', {
    id: linkedBody.user.id,
    did: linkedBody.user.did,
  });
  assert.equal(linked.did, verifiedBody.identity.did);
  assert.equal(linked.email, 'learner@example.edu');
});

test('Solana and Midnight proofs verify only the challenged message', async () => {
  const { verifyLearnWalletProof } = await import('../lib/auth/wallet-proof');
  const { walletSignInMessage } = await import('../lib/auth/wallet-sign-in-message');
  const message = walletSignInMessage({ origin: 'https://drmz.test', chain: 'midnight', address: 'test-address', challenge: 'test-id', nonce: 'test-nonce', expiresAt: Date.now() + 60000 });
  const payloadHex = Buffer.from(message).toString('hex');

  const solanaSecret = ed25519.utils.randomSecretKey();
  const solanaPublic = ed25519.getPublicKey(solanaSecret);
  const solanaAddress = encodeBase58(solanaPublic);
  const solanaSignature = ed25519.sign(
    new TextEncoder().encode(message),
    solanaSecret,
  );
  const solana = await verifyLearnWalletProof({
    chain: 'solana',
    address: solanaAddress,
    message,
    payloadHex,
    proof: {
      chain: 'solana',
      signature: Buffer.from(solanaSignature).toString('base64'),
    },
  });
  assert.equal(solana?.key, solanaAddress);

  const midnightSecret = sampleSigningKey();
  const { UnshieldedAddress } = await import('@midnight-ntwrk/wallet-sdk-address-format');
  const midnightKey = signatureVerifyingKey(midnightSecret);
  const midnightAddress = UnshieldedAddress.codec.encode('preview', new UnshieldedAddress(Buffer.from(addressFromKey(midnightKey), 'hex'))).toString();
  const midnightSignature = signData(
    midnightSecret,
    new TextEncoder().encode(`midnight_signed_message:${Buffer.byteLength(message)}:${message}`),
  );
  const midnight = await verifyLearnWalletProof({
    chain: 'midnight',
    address: midnightAddress,
    message,
    payloadHex,
    proof: {
      chain: 'midnight',
      data: message,
      signature: midnightSignature,
      verifyingKey: midnightKey,
    },
  });
  assert.equal(midnight?.key, midnightKey.toLowerCase());

  const tampered = await verifyLearnWalletProof({
    chain: 'midnight',
    address: midnightAddress,
    message: `${message}x`,
    payloadHex,
    proof: {
      chain: 'midnight',
      data: `${message}x`,
      signature: midnightSignature,
      verifyingKey: midnightKey,
    },
  });
  assert.equal(tampered, null);
  const proof = { chain: 'midnight' as const, data: Buffer.from(message).toString('hex'), signature: midnightSignature, verifyingKey: midnightKey };
  const input = { chain: 'midnight' as const, address: midnightAddress, message, payloadHex, proof };
  assert.equal((await verifyLearnWalletProof(input))?.key, midnightKey, 'wallet-returned data encoding does not replace the server challenge');
  const anotherKey = signatureVerifyingKey(sampleSigningKey());
  const anotherAddress = UnshieldedAddress.codec.encode('preview', new UnshieldedAddress(Buffer.from(addressFromKey(anotherKey), 'hex'))).toString();
  assert.equal(await verifyLearnWalletProof({ ...input, address: anotherAddress }), null, 'signature must own the claimed unshielded address');
  assert.equal(await verifyLearnWalletProof({ ...input, proof: { ...proof, signature: signData(midnightSecret, new TextEncoder().encode(message)) } }), null, 'unprefixed transaction-style signature is not a login');
  const unicode = 'DRMZ 🌙 sign-in';
  const unicodeSignature = signData(midnightSecret, new TextEncoder().encode(`midnight_signed_message:${Buffer.byteLength(unicode)}:${unicode}`));
  assert.ok(await verifyLearnWalletProof({ ...input, message: unicode, proof: { ...proof, signature: unicodeSignature } }), 'prefix length counts UTF-8 bytes');
});

test('Cardano CIP-30 signData accepts only the matching address and payload', async () => {
  const CSL = await import('@emurgo/cardano-serialization-lib-nodejs');
  const CMS = await import('@emurgo/cardano-message-signing-nodejs');
  const { verifyLearnWalletProof } = await import('../lib/auth/wallet-proof');
  const key = CSL.PrivateKey.generate_ed25519();
  const address = CSL.EnterpriseAddress.new(0, CSL.Credential.from_keyhash(key.to_public().hash())).to_address();
  const message = 'DRMZ sign-in test: never a transaction';
  const payloadHex = Buffer.from(message).toString('hex');
  const headers = CMS.HeaderMap.new();
  headers.set_algorithm_id(CMS.Label.from_algorithm_id(CMS.AlgorithmId.EdDSA));
  headers.set_header(CMS.Label.new_text('address'), CMS.CBORValue.new_bytes(address.to_bytes()));
  const builder = CMS.COSESign1Builder.new(CMS.Headers.new(CMS.ProtectedHeaderMap.new(headers), CMS.HeaderMap.new()), Buffer.from(payloadHex, 'hex'), false);
  const signed = builder.build(key.sign(builder.make_data_to_sign().to_bytes()).to_bytes());
  const cose = CMS.COSEKey.new(CMS.Label.new_int(CMS.Int.new_i32(1)));
  cose.set_algorithm_id(CMS.Label.from_algorithm_id(CMS.AlgorithmId.EdDSA));
  cose.set_header(CMS.Label.new_int(CMS.Int.new_i32(-1)), CMS.CBORValue.new_int(CMS.Int.new_i32(6)));
  cose.set_header(CMS.Label.new_int(CMS.Int.new_i32(-2)), CMS.CBORValue.new_bytes(key.to_public().as_bytes()));
  const input = { chain: 'cardano' as const, address: address.to_bech32(), message, payloadHex,
    proof: { chain: 'cardano' as const, key: Buffer.from(cose.to_bytes()).toString('hex'), signature: Buffer.from(signed.to_bytes()).toString('hex') } };
  assert.equal((await verifyLearnWalletProof(input))?.key, key.to_public().hash().to_hex());
  assert.equal(await verifyLearnWalletProof({ ...input, payloadHex: Buffer.from('different nonce').toString('hex') }), null);
  const other = CSL.PrivateKey.generate_ed25519();
  const otherAddress = CSL.EnterpriseAddress.new(0, CSL.Credential.from_keyhash(other.to_public().hash())).to_address().to_bech32();
  assert.equal(await verifyLearnWalletProof({ ...input, address: otherAddress }), null);
});
