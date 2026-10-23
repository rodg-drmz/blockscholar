import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StrikeMission } from '../packages/spaces-studio/src/strike-mission.jsx';
import { StrikeWalletSetup } from '../packages/spaces-studio/src/strike-wallet-setup.jsx';

test('Mission renders before wallet connection and while funding is unknown', async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} } });
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [name, descriptor] of [['window', originalWindow], ['document', originalDocument]] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  for (const record of [null, {}, { lessonAt: '2026-10-23T00:00:00Z' }, { accountId: 'test-account', wallet: 'addr_test1example' }]) {
    await t.test(JSON.stringify(record), async () => {
      globalThis.fetch = async () => new Response(JSON.stringify({ enabled: true, authenticated: !!record, record, questions: [], builderConfigured: true, reward: { lovelace: 2_000_000, limit: 20 } }), { headers: { 'content-type': 'application/json' } });
      let renderer: ReactTestRenderer | undefined;
      const errors: Error[] = [];
      class Boundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
        state = { failed: false };
        static getDerivedStateFromError() { return { failed: true }; }
        componentDidCatch(error: Error) { errors.push(error); }
        render() { return this.state.failed ? null : this.props.children; }
      }
      try {
        await act(async () => { renderer = create(React.createElement(Boundary, null, React.createElement(StrikeMission, { embedded: true }))); });
        assert.deepEqual(errors.map(e => e.message), [], 'Entering Mission must not crash before a balance check');
        const html = JSON.stringify(renderer!.toJSON());
        assert.match(html, /Cardano wallet/);
        assert.doesNotMatch(html, /Add test trading credits before placing an order/, 'Unknown balance must not be presented as zero');
      } finally { act(() => renderer?.unmount()); }
    });
  }
});

test('wallet setup safely renders a fresh record without a funding response', () => {
  let renderer: ReactTestRenderer | undefined;
  try {
    act(() => { renderer = create(React.createElement(StrikeWalletSetup, { data: { record: {} }, funding: null, busy: '', connected: false, walletControls: null, act() {}, deposit() {}, signDeposit() {}, reconnect() {} })); });
    assert.match(JSON.stringify(renderer!.toJSON()), /Connect your practice wallet/);
  } finally { act(() => renderer?.unmount()); }
});
