import { readAuthJson, allowAuthRequest } from '@/lib/auth/request-guard';
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  appSessionSecretStatus,
  readAppSession,
} from '@/app/api/lib/auth-session';
import { saveChallenge } from '@/app/api/lib/auth-store';
import type { LearnWalletChain } from '@/lib/auth/learn-identity-store';
import { walletSignInMessage } from '@/lib/auth/wallet-sign-in-message';

export const runtime = 'nodejs';

type Body = {
  chain?: unknown;
  address?: unknown;
  walletName?: unknown;
  network?: unknown;
};

type WalletLoginChallenge = {
  version: 1;
  chain: LearnWalletChain;
  address: string;
  walletName: string | null;
  network: string | null;
  message: string;
  payloadHex: string;
  expiresAt: number;
  preferred: {
    id: string;
    did: string | null;
    email: string | null;
  } | null;
};

function parseChain(value: unknown): LearnWalletChain | null {
  return value === 'cardano' ||
    value === 'midnight' ||
    value === 'ethereum' ||
    value === 'solana'
    ? value
    : null;
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const next = value.trim();
  return next && next.length <= max ? next : null;
}

export async function POST(req: Request) {
  if (!allowAuthRequest('wallet', 'global', 1200, 60 * 60_000)) return NextResponse.json({error:'Too many sign-in requests. Please try later.'}, {status:429});
  if (appSessionSecretStatus() !== 'configured') {
    return NextResponse.json(
      {
        ok: false,
        error: 'Wallet sign-in is not configured on this server.',
      },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await readAuthJson(req)) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const chain = parseChain(body.chain);
  const address = clean(body.address, 512);
  if (!chain || !address || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(address)) {
    return NextResponse.json(
      { ok: false, error: 'A supported wallet chain and address are required.' },
      { status: 400 },
    );
  }

  const id = randomBytes(24).toString('base64url');
  const nonce = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 5 * 60_000;
  const origin = new URL(process.env.APP_ORIGIN || req.url).origin;
  const walletName = clean(body.walletName, 120);
  const network = clean(body.network, 120);
  const session = readAppSession(req);
  const preferred =
    session.kind === 'verified'
      ? {
          id: session.user.id,
          did: session.user.did ?? null,
          email: session.user.email,
        }
      : null;
  const message = walletSignInMessage({ origin, challenge: id, nonce, chain, address, expiresAt, linkExistingAccount: preferred !== null });
  const challenge: WalletLoginChallenge = {
    version: 1,
    chain,
    address,
    walletName,
    network,
    message,
    payloadHex: Buffer.from(message, 'utf8').toString('hex'),
    expiresAt,
    preferred,
  };

  await saveChallenge(`wallet-${id}`, challenge, 5 * 60_000);
  return NextResponse.json(
    {
      ok: true,
      challenge: {
        id,
        chain,
        message,
        payloadHex: challenge.payloadHex,
        expiresAt,
      },
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
