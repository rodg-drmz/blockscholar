import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StrikeMission } from '../packages/spaces-studio/src/strike-mission.jsx';
import { StrikeWalletSetup } from '../packages/spaces-studio/src/strike-wallet-setup.jsx';
import { BlockscholarProgram } from '../packages/spaces-studio/src/blockscholar-program.jsx';

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

test('entering Mission reports a resumable view and restores it after a sign-in reload', async (t) => {
  const descriptors = ['window', 'document', 'fetch'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  t.after(() => { for (const [name, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
  } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener() {}, removeEventListener() {} } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} } });
  const mission = { enabled: true, authenticated: true, record: null, questions: [], builderConfigured: true, reward: { configured: true } };
  globalThis.fetch = async (path) => Response.json(String(path) === '/api/learn/blockscholar'
    ? { mission, viewer: 'render-test', practice: {prepScore: 8, challengeScore: 0, credits: 0} } : mission);
  let renderer: ReactTestRenderer | undefined;
  let view = 'learn';
  try {
    await act(async () => { renderer = create(React.createElement(BlockscholarProgram, { initialView: 'learn', onViewChange: (next: string) => { view = next; } })); });
    const enter = renderer!.root.findAllByType('button').find(button => button.props.children === 'Enter the workshop →');
    assert.ok(enter);
    await act(async () => enter.props.onClick());
    assert.equal(view, 'mission');
    act(() => renderer!.unmount());
    await act(async () => { renderer = create(React.createElement(BlockscholarProgram, { initialView: view })); });
    assert.equal(renderer!.root.findByProps({'aria-label': 'Verified Strike mission'}).props.hidden, false);
    assert.equal(renderer!.root.findByProps({'aria-label': 'Strike lessons'}).props.hidden, true);
    assert.match(JSON.stringify(renderer!.toJSON()), /Your testnet workspace/);
  } finally { act(() => renderer?.unmount()); }
});
