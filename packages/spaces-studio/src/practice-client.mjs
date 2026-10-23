import { emptyPractice, practiceAction } from '../../../lib/spaces/learning-practice.mjs';
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
    if (action) { try { storage.setItem(KEY, JSON.stringify(result.state)); } catch { throw new Error('Could not save guest practice. Enable browser storage or sign in, then retry.'); } }
    return { ...result, scope: 'device' };
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Practice is unavailable. Try again.');
  return data;
}
