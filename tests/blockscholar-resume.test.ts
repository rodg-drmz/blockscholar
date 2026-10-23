import test from 'node:test';
import assert from 'node:assert/strict';
import { practiceRequest, resumeGuestPreparation } from '../packages/spaces-studio/src/practice-client.mjs';
import { curriculum, emptyPractice, practiceAction } from '../lib/spaces/learning-practice.mjs';
import { programReturnPath } from '../app/lib/blockscholar-navigation';

const key = 'drmz:blockchain-practice:guest:v1';
const answers = curriculum.prep.map((q: {correct: number}) => q.correct);
function memory() {
  const values = new Map<string, string>();
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
}
const guestFetch = async () => new Response('{}', { status: 401 });

test('guest quiz answers are regraded and saved after sign-in, without claiming anything', async () => {
  const storage = memory();
  await practiceRequest({type: 'prep', answers}, guestFetch, storage);
  let account = emptyPractice();
  const calls: any[] = [];
  const fetcher = async (_url: any, init: any) => {
    const action = JSON.parse(init.body); calls.push(action);
    account = practiceAction(account, action).state;
    return Response.json({state: account, scope: 'account'});
  };
  const saved = await resumeGuestPreparation(account, 'learner-a', fetcher, storage);
  assert.equal(saved.scope, 'account'); assert.equal(saved.state.prepScore, 8);
  assert.deepEqual(calls, [{type: 'prep', answers}]);
  assert.equal(saved.state.credits, 0);
  await resumeGuestPreparation(account, 'learner-a', fetcher, storage);
  assert.equal(calls.length, 1, 'A saved result must not be resubmitted on every reload');
  const other = await resumeGuestPreparation(emptyPractice(), 'learner-b', fetcher, storage);
  assert.equal(other.state.prepScore, 0, 'Do not move the guest attempt to a second account');
});

test('a lower guest retake does not replace the answers for the best score', async () => {
  const storage = memory();
  await practiceRequest({type: 'prep', answers}, guestFetch, storage);
  await practiceRequest({type: 'prep', answers: answers.map((n: number, i: number) => (n + 1) % curriculum.prep[i].choices.length)}, guestFetch, storage);
  assert.deepEqual(JSON.parse(storage.getItem(key)!).prepAnswers, answers);
});

test('legacy scores stay browser-only and do not reset preparation or mint server evidence', async () => {
  const storage = memory();
  storage.setItem(key, JSON.stringify({...emptyPractice(), prepScore: 8, challengeScore: 4, credits: 100}));
  const saved = await resumeGuestPreparation(emptyPractice(), 'learner-a', async () => { throw new Error('Should not submit a grade'); }, storage);
  assert.equal(saved.state.prepScore, 8); assert.equal(saved.scope, 'device');
  assert.equal(saved.state.challengeScore, 0); assert.equal(saved.state.credits, 0);
  assert.match(saved.notice!, /Continue to wallet setup/);
});

test('network interruption preserves guest answers for a safe retry', async () => {
  const storage = memory();
  await practiceRequest({type: 'prep', answers}, guestFetch, storage);
  const saved = await resumeGuestPreparation(emptyPractice(), 'learner-a', async () => { throw new Error('offline'); }, storage);
  assert.equal(saved.scope, 'device'); assert.equal(saved.state.prepScore, 8);
  assert.deepEqual(JSON.parse(storage.getItem(key)!).prepAnswers, answers);
});

test('unavailable browser storage never breaks account progress', async () => {
  const savedState = {...emptyPractice(), prepScore: 7};
  const saved = await resumeGuestPreparation(savedState, 'learner-a', guestFetch, {getItem() {throw new Error('disabled');}});
  assert.deepEqual(saved, {state: savedState, scope: 'account'});
});

test('wallet reloads and email returns use the requested local program step', () => {
  assert.equal(programReturnPath('mission'), '/learn/blockscholar?view=mission');
  assert.equal(programReturnPath('learn'), '/learn/blockscholar?view=learn');
  assert.equal(programReturnPath('program'), '/learn/blockscholar');
  for (const invalid of ['https://outside.test', '//outside.test', 'mission&return=outside', '']) {
    assert.equal(programReturnPath(invalid), '/learn/blockscholar');
  }
});
