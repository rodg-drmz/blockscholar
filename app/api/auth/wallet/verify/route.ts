import { readAuthJson, allowAuthRequest } from '@/lib/auth/request-guard';
import { NextResponse } from 'next/server';
import {
  appSessionSecretStatus,
  jsonWithUser,
  type DrmzUser,
} from '@/app/api/lib/auth-session';
import { consumeChallenge } from '@/app/api/lib/auth-store';
import {
  resolveWalletAccount,
  type LearnWalletChain,
} from '@/lib/auth/learn-identity-store';
import {
  verifyLearnWalletProof,
  type WalletProof,
} from '@/lib/auth/wallet-proof';

export const runtime = 'nodejs';

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

type Body = {
  challengeId?: unknown;
  proof?: unknown;
};

export async function POST(req: Request) {
  if (!allowAuthRequest('wallet', 'global', 1200, 60 * 60_000)) return NextResponse.json({error:'Too many sign-in requests. Please try later.'}, {status:429});
  if (appSessionSecretStatus() !== 'configured') {
    return NextResponse.json(
      { ok: false, error: 'Wallet sign-in is not configured on this server.' },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await readAuthJson(req)) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const challengeId =
    typeof body.challengeId === 'string' &&
    /^[A-Za-z0-9_-]{20,80}$/.test(body.challengeId)
      ? body.challengeId
      : null;
  if (!challengeId || !body.proof || typeof body.proof !== 'object') {
    return NextResponse.json(
      { ok: false, error: 'Wallet challenge and signature are required.' },
      { status: 400 },
    );
  }

  const challenge = await consumeChallenge<WalletLoginChallenge>(
    `wallet-${challengeId}`,
  );
  if (
    !challenge ||
    challenge.version !== 1 ||
    challenge.expiresAt <= Date.now()
  ) {
    return NextResponse.json(
      { ok: false, error: 'Wallet sign-in challenge expired. Try again.' },
      { status: 401 },
    );
  }

  const verified = await verifyLearnWalletProof({
    chain: challenge.chain,
    address: challenge.address,
    message: challenge.message,
    payloadHex: challenge.payloadHex,
    proof: body.proof as WalletProof,
  });
  if (!verified) {
    return NextResponse.json(
      {
        ok: false,
        error: 'The wallet signature is invalid or belongs to another account.',
      },
      { status: 401 },
    );
  }

  try {
    const account = await resolveWalletAccount(
      {
        chain: verified.chain,
        key: verified.key,
        address: verified.address,
        walletName: challenge.walletName,
        network: challenge.network,
      },
      challenge.preferred ?? undefined,
    );
    const wallet = account.wallets.find(
      (entry) => entry.chain === verified.chain && entry.key === verified.key,
    );
    const user: DrmzUser = {
      id: account.id,
      name:
        account.email?.split('@')[0] ||
        challenge.walletName ||
        `${verified.chain[0]?.toUpperCase()}${verified.chain.slice(1)} learner`,
      email: account.email,
      picture: null,
      provider: 'wallet',
      did: account.did,
      wallet: {
        chain: verified.chain,
        address: verified.address,
        key: verified.key,
        walletName: challenge.walletName,
        network: challenge.network,
      },
    };
    return jsonWithUser(user, {
      ok: true,
      identity: {
        id: account.id,
        did: account.did,
        email: account.email,
        provider: 'wallet',
        wallet: wallet ?? {
          chain: verified.chain,
          address: verified.address,
          walletName: challenge.walletName,
          network: challenge.network,
        },
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not link this wallet.';
    const conflict = /already linked|different backup email/i.test(message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: conflict ? 409 : 500 },
    );
  }
}
