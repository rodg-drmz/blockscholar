import type { NextRequest } from 'next/server';

export function isLocalMagicHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function allowInlineMagicLink(opts: {
  hostname: string;
  nodeEnv?: string | undefined;
  inlineEnv?: string | undefined;
}): boolean {
  const flag = (opts.inlineEnv ?? '').trim().toLowerCase();
  if (['0', 'false', 'no'].includes(flag)) return false;
  // Development servers can be reached through a public phone-test tunnel.
  // Never turn an unverified email address into a session on that public origin.
  return isLocalMagicHost(opts.hostname);
}

export function resolveMagicLinkOrigin(opts: {
  nextOrigin: string;
  headerOrigin: string | null;
  forwardedProto: string | null;
  forwardedHost: string | null;
  host: string | null;
}): string {
  if (opts.headerOrigin) {
    try {
      const fromHeader = new URL(opts.headerOrigin);
      const fromNext = new URL(opts.nextOrigin);
      if (
        fromHeader.protocol === fromNext.protocol &&
        fromHeader.port === fromNext.port &&
        (fromHeader.hostname === fromNext.hostname ||
          (isLocalMagicHost(fromHeader.hostname) && isLocalMagicHost(fromNext.hostname)))
      ) {
        return fromHeader.origin;
      }
    } catch {
      /* use forwarded / nextUrl */
    }
  }

  const proto = opts.forwardedProto?.split(',')[0]?.trim().replace(/:$/, '');
  const host = opts.forwardedHost?.split(',')[0]?.trim() || opts.host?.trim() || '';
  if (proto && host) return `${proto}://${host}`;
  return opts.nextOrigin;
}

export function magicLinkOriginFromRequest(request: NextRequest): string {
  if (process.env.APP_ORIGIN) return new URL(process.env.APP_ORIGIN).origin;
  return resolveMagicLinkOrigin({
    nextOrigin: request.nextUrl.origin,
    headerOrigin: request.headers.get('origin'),
    forwardedProto: request.headers.get('x-forwarded-proto'),
    forwardedHost: request.headers.get('x-forwarded-host'),
    host: request.headers.get('host'),
  });
}

export function allowInlineMagicLinkFromRequest(request: NextRequest): boolean {
  return allowInlineMagicLink({
    hostname: new URL(magicLinkOriginFromRequest(request)).hostname,
    nodeEnv: process.env.NODE_ENV,
    inlineEnv: process.env.AUTH_MAGIC_LINK_INLINE,
  });
}
