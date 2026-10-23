import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileDeposit} from '../packages/spaces-studio/src/deposit-progress.mjs';

test('settled receipt advances without requiring a browser trading key or registration retry', async () => {
  const result = {record:{deposit:{status:'verified',creditedUsd:'24.5'}}};
  const outcome = await reconcileDeposit({check:async()=>result,read:async()=>{throw Error('unexpected');},register:async()=>{throw Error('expired key');}});
  assert.equal(outcome.result,result); assert.equal(outcome.warning,'');
});
test('a failed registration does not prevent checking the existing receipt', async () => {
  const calls:string[]=[];
  const result = {record:{deposit:{status:'submitted',chainConfirmedAt:123}}};
  const outcome=await reconcileDeposit({check:async()=>{calls.push('check');return result;},read:async()=>result,register:async()=>{calls.push('register');throw Error('Reconnect to resume');}});
  assert.deepEqual(calls,['check','register']); assert.equal(outcome.result,result); assert.match(outcome.warning,/Reconnect/);
});
test('network errors restore persisted Cardano progress and remain visible', async () => {
  const result = {record:{deposit:{status:'registered',chainConfirmedAt:123}}};
  const outcome=await reconcileDeposit({check:async()=>{throw Error('Strike receipt unavailable');},read:async()=>result,register:undefined});
  assert.equal(outcome.result,result); assert.match(outcome.warning,/unavailable/);
});
test('already registered deposits only read receipts and never register again', async () => {
  const result={record:{deposit:{status:'registered'}}};
  const outcome=await reconcileDeposit({check:async()=>result,read:async()=>result,register:async()=>{assert.fail('Must not register twice');}});
  assert.equal(outcome.result,result);
});
