import curriculum from './blockchain-curriculum.json' with { type: 'json' };
export { curriculum };
export class PracticeError extends Error {}
export const emptyPractice = () => ({ version: 1, prepScore: 0, challengeScore: 0, credits: 0, claimedAt: null, updatedAt: null });
export const practiceReward = score => score === 4 ? 100 : score >= 3 ? 50 : 0;
export function assessPractice(kind, answers) {
  const questions = kind === 'prep' ? curriculum.prep : kind === 'challenge' ? curriculum.challenge : null;
  if (!questions || !Array.isArray(answers) || answers.length !== questions.length || answers.some((v, i) => !Number.isInteger(v) || v < 0 || v >= questions[i].choices.length)) throw new PracticeError('Answer every scenario before submitting.');
  const score = questions.filter((q, i) => answers[i] === q.correct).length;
  return { score, total: questions.length, passed: score >= (kind === 'prep' ? curriculum.prepPass : curriculum.challengePass) };
}
export function practiceAction(previous, action, now = new Date().toISOString()) {
  const state = { ...emptyPractice(), ...previous };
  if (!action || !['prep', 'challenge', 'claim'].includes(action.type)) throw new PracticeError('Choose a practice action.');
  if (action.type !== 'prep' && state.prepScore < curriculum.prepPass) throw new PracticeError('Complete the preparation scenarios first (6 of 8).');
  if (action.type === 'claim') {
    const target = practiceReward(state.challengeScore);
    if (!target) throw new PracticeError('Pass the Stadium assessment first (3 of 4).');
    const award = Math.max(0, target - state.credits);
    return { state: { ...state, credits: Math.max(state.credits, target), claimedAt: state.claimedAt || now, updatedAt: now }, award };
  }
  const result = assessPractice(action.type, action.answers), field = action.type === 'prep' ? 'prepScore' : 'challengeScore';
  return { state: { ...state, [field]: Math.max(state[field], result.score), updatedAt: now }, result };
}
