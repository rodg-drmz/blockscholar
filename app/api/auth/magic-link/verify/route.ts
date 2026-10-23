import { NextRequest } from 'next/server';
import { appSessionSecretStatus, redirectWithUser, type DrmzUser } from '@/app/api/lib/auth-session';
import { consumeMagicToken } from '@/app/api/lib/auth-store';
import { magicLinkOriginFromRequest } from '@/app/api/lib/magic-link-door';
import { resolveEmailAccount } from '@/lib/auth/learn-identity-store';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  if (appSessionSecretStatus() !== 'configured') {
    return Response.json({ error: 'Sign-in is temporarily unavailable. Please retry this link after server configuration is restored.' }, { status: 503 });
  }
  const token = request.nextUrl.searchParams.get('token')?.trim();
  const returnTo = request.nextUrl.searchParams.get('return')?.trim() || '/home';
  const origin = magicLinkOriginFromRequest(request);

  const failPath = "/learn/blockscholar";

  if (!token) {
    const err = new URL(failPath, origin);
    err.searchParams.set('auth', 'error');
    err.searchParams.set('error', 'Missing magic link token');
    return Response.redirect(err);
  }

  const record = await consumeMagicToken(token);
  if (!record) {
    const err = new URL(failPath, origin);
    err.searchParams.set('auth', 'error');
    err.searchParams.set('error', 'This sign-in link is invalid or expired');
    return Response.redirect(err);
  }

  try {
    const account = await resolveEmailAccount(
      record.email,
      record.linkSubjectId
        ? {
            id: record.linkSubjectId,
            did: record.linkDid,
          }
        : undefined,
    );
    const user: DrmzUser = {
      id: account.id,
      name: record.email.split('@')[0] || 'Learner',
      email: account.email,
      picture: null,
      provider: 'email_link',
      did: account.did,
      wallet: account.wallets[0]
        ? {
            chain: account.wallets[0].chain,
            address: account.wallets[0].address,
            walletName: account.wallets[0].walletName,
            network: account.wallets[0].network,
          }
        : null,
    };
    return redirectWithUser(origin, returnTo, user);
  } catch (error) {
    const destination = new URL(failPath, origin);
    destination.searchParams.set('auth', 'error');
    destination.searchParams.set(
      'error',
      error instanceof Error ? error.message : 'Could not verify this email.',
    );
    return Response.redirect(destination);
  }
}
