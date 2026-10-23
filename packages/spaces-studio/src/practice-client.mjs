import { emptyPractice, practiceAction, assessPractice } from '../../../lib/spaces/learning-practice.mjs';
const KEY = 'drmz:blockchain-practice:guest:v1';
function guestState(storage) {
  let state;
  try { state = JSON.parse(storage.getItem(KEY) || 'null'); } catch (error) { if (error instanceof SyntaxError) return emptyPractice(); throw new Error('Enable browser storage to keep guest practice, or sign in to a DRMZ account.'); }
  if (!state) return emptyPractice();
  if (state.version !== 1 || !Number.isInteger(state.prepScore) || state.prepScore < 0 || state.prepScore > 8 || !Number.isInteger(state.challengeScore) || state.challengeScore < 0 || state.challengeScore > 4 || ![0, 50, 100].includes(state.credits)) return emptyPractice();
  return state;
}
export async function practiceRequest(action, fetcher = fetch, storage) {
  const response = await fetcher('/api/spaces/practice', { credentials: 'include', cache: 'no-store', ...(action ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) } : {}) });
  if (response.status === 401) {
    if (!storage) { try { storage = globalThis.localStorage; } catch { throw new Error('Enable browser storage or sign in to save your practice.'); } }
    const state = guestState(storage), result = action ? practiceAction(state, action) : { state };
    if (action) { try {
      const retained = { ...result.state, ...(state.prepAnswers ? { prepAnswers: state.prepAnswers } : {}), ...(state.owner ? { owner: state.owner } : {}) };
      if (action.type === 'prep' && result.result.score >= state.prepScore) {
        retained.prepAnswers = [...action.answers];
        delete retained.owner;
      }
      storage.setItem(KEY, JSON.stringify(retained));
    } catch { throw new Error('Could not save guest practice. Enable browser storage or sign in, then retry.'); } }
    return { ...result, scope: 'device' };
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Practice is unavailable. Try again.');
  return data;
}

// Transfer answers, never a client-supplied grade, transaction, or reward.
// Old releases stored only a score: keep that as browser-only preparation so
// those learners can continue the workshop without inventing server evidence.
export async function resumeGuestPreparation(accountState, viewer, fetcher = fetch, storage) {
  const account = { state: accountState, scope: 'account' };
  if (!viewer) return account;
  let guest;
  try {
    storage ||= globalThis.localStorage;
    guest = guestState(storage);
    if (!guest.prepScore || guest.owner && guest.owner !== viewer) return account;
    guest = { ...guest, owner: viewer };
    storage.setItem(KEY, JSON.stringify(guest));
  } catch { return account; }
  if (guest.prepScore <= accountState.prepScore) return account;
  let validAnswers = false;
  try { validAnswers = assessPractice('prep', guest.prepAnswers).score === guest.prepScore; } catch { /* Legacy browser-only score. */ }
  if (validAnswers) {
    try {
      const response = await fetcher('/api/spaces/practice', { method: 'POST', credentials: 'include', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'prep', answers: guest.prepAnswers }) });
      const saved = await response.json();
      if (!response.ok || saved.scope !== 'account') throw new Error('Preparation sync unavailable');
      return saved;
    } catch {
      return { state: { ...accountState, prepScore: guest.prepScore }, scope: 'device', notice: 'Quiz saved on this device. You can continue while account syncing retries.' };
    }
  }
  return { state: { ...accountState, prepScore: guest.prepScore }, scope: 'device', notice: 'Quiz saved on this device. Continue to wallet setup.' };
}
