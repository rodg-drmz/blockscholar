import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowInlineMagicLink, resolveMagicLinkOrigin } from './magic-link-door';

test('inline magic links are local-only, including on development tunnels', () => {
  assert.equal(allowInlineMagicLink({ hostname: 'localhost', nodeEnv: 'production' }), true);
  assert.equal(allowInlineMagicLink({ hostname: 'learn.example', nodeEnv: 'production' }), false);
  assert.equal(
    allowInlineMagicLink({ hostname: 'learn.example', nodeEnv: 'production', inlineEnv: '1' }),
    false,
  );
  assert.equal(allowInlineMagicLink({ hostname: 'phone.example.test', nodeEnv: 'development' }), false);
  assert.equal(allowInlineMagicLink({ hostname: 'localhost', nodeEnv: 'development', inlineEnv: 'false' }), false);
});

test('public origin prefers forwarded host on Railway-style proxies', () => {
  assert.equal(
    resolveMagicLinkOrigin({
      nextOrigin: 'http://localhost:8080',
      headerOrigin: null,
      forwardedProto: 'https',
      forwardedHost: 'drmz.tech',
      host: 'localhost:8080',
    }),
    'https://drmz.tech',
  );
  assert.equal(
    resolveMagicLinkOrigin({
      nextOrigin: 'https://0.0.0.0:8080',
      headerOrigin: null,
      forwardedProto: 'https',
      forwardedHost: 'drmz.tech',
      host: '0.0.0.0:8080',
    }),
    'https://drmz.tech',
  );
});
