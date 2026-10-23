import { readAuthJson, allowAuthRequest } from '@/lib/auth/request-guard';
import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { appSessionSecretStatus, isValidEmail, readAppSession, jsonWithUser } from '@/app/api/lib/auth-session';
import { saveMagicToken } from '@/app/api/lib/auth-store';
import {
  allowInlineMagicLinkFromRequest,
  magicLinkOriginFromRequest,
} from '@/app/api/lib/magic-link-door';
import { isResendTestSender, sendResendEmail } from '@/app/api/lib/resend';
import { buildSignInWelcomeMail } from '@/lib/auth/welcome-mail';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  if (!allowAuthRequest('email', 'global', 60, 60 * 60_000)) return NextResponse.json({error:'Too many sign-in requests. Please try later.'}, {status:429});
  if (appSessionSecretStatus() !== 'configured') {
    return NextResponse.json({ error: 'Sign-in is temporarily unavailable. The server session key needs configuration.' }, { status: 503 });
  }
  let body: { email?: string; returnTo?: string; intent?: string };
  try {
    body = await readAuthJson(request);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
  }

  if (!allowAuthRequest('email-recipient', email, 5, 15 * 60_000)) return NextResponse.json({error:'Please check your inbox or wait before requesting another link.'}, {status:429});

  const returnTo =
    typeof body.returnTo === 'string' && body.returnTo.startsWith('/') && !body.returnTo.startsWith('//') ? body.returnTo : '/home';

  const session = readAppSession(request);
  const linking = body.intent === 'link';
  if (!linking && session.kind === 'verified' && session.user.provider === 'email_link' && session.user.email === email) {
    return jsonWithUser(session.user, { ok: true, entered: true, email, message: 'Welcome back.' });
  }
  if (linking && session.kind !== 'verified') {
    return NextResponse.json(
      { error: 'Sign in with your wallet before adding a backup email.' },
      { status: 401 },
    );
  }
  if (
    linking &&
    session.kind === 'verified' &&
    session.user.email &&
    session.user.email !== email
  ) {
    return NextResponse.json(
      { error: 'This account already has a different backup email.' },
      { status: 409 },
    );
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + 15 * 60 * 1000;
  await saveMagicToken(token, {
    email,
    expiresAt,
    ...(linking && session.kind === 'verified'
      ? {
          linkSubjectId: session.user.id,
          linkDid: session.user.did ?? null,
        }
      : {}),
  });

  const origin = magicLinkOriginFromRequest(request);
  const verifyUrl = new URL('/api/auth/magic-link/verify', origin);
  verifyUrl.searchParams.set('token', token);
  verifyUrl.searchParams.set('return', returnTo);

  const mail = buildSignInWelcomeMail({ origin, verifyUrl: verifyUrl.toString() });

  try {
    const emailResult = await sendResendEmail({ to: email, ...mail });
    const allowInline = process.env.NODE_ENV !== 'production' && allowInlineMagicLinkFromRequest(request);

    if (emailResult.sent && !allowInline) {
      return NextResponse.json({
        ok: true,
        emailSent: true,
        firstVisit: true,
        message: linking
          ? 'Check your inbox to add this backup email.'
          : 'Check your inbox for a one-time sign-in link. Your verified session lasts seven days.',
      });
    }

    if (allowInline) {
      const testSender = isResendTestSender();
      const sendFailed = !emailResult.sent && emailResult.reason === 'send_failed';
      const detail = sendFailed ? emailResult.detail : undefined;
      return NextResponse.json({
        ok: true,
        emailSent: Boolean(emailResult.sent),
        firstVisit: true,
        message: emailResult.sent
          ? 'Check your inbox, or use the one-time development link below.'
          : sendFailed
            ? `${testSender ? 'Resend’s test sender only delivers to your Resend account email. ' : ''}${detail ? `${detail} ` : ''}Use the one-time link below.`
            : 'Email is not configured yet. Use the one-time link below.',
        devLink: verifyUrl.toString(),
      });
    }

    const sendFailed = !emailResult.sent && emailResult.reason === 'send_failed';
    return NextResponse.json(
      {
        error: sendFailed
          ? `${isResendTestSender() ? 'Resend’s test sender only delivers to the Resend account email. ' : ''}${emailResult.detail || 'The mail provider rejected this send.'} Verify a sending domain, then set AUTH_MAGIC_LINK_FROM.`
          : 'Magic link email is not available on this server. Verify a sending domain in Resend, then set RESEND_API_KEY and AUTH_MAGIC_LINK_FROM.',
      },
      { status: 503 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send email';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
