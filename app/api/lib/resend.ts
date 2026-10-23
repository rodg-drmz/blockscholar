/** Shared Resend sender for magic links and EDU result mail. */

export function getResendFrom() {
  return (
    process.env.AUTH_MAGIC_LINK_FROM?.trim() ||
    process.env.RESEND_FROM?.trim() ||
    'DRMZ Network <onboarding@resend.dev>'
  );
}

export function isResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export async function sendResendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<
  | { sent: true }
  | { sent: false; reason: 'email_not_configured' }
  | { sent: false; reason: 'send_failed'; status: number; detail?: string }
> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { sent: false, reason: 'email_not_configured' };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: getResendFrom(),
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: unknown; name?: unknown } | null;
    const detail =
      body && typeof body.message === 'string'
        ? body.message
        : body && typeof body.name === 'string'
          ? body.name
          : undefined;
    return { sent: false, reason: 'send_failed', status: res.status, detail };
  }

  return { sent: true };
}

export function isResendTestSender(from = getResendFrom()) {
  return /onboarding@resend\.dev/i.test(from);
}
