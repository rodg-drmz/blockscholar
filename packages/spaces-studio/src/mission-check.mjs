/** Validate the form, never grade it here. Only the authenticated server can save a pass. */
export function lessonSubmission(data, answers) {
  const questions = data?.questions || [];
  const missing = questions.filter(q => !Number.isInteger(answers[q.id]) || answers[q.id] < 0 || answers[q.id] >= q.choices.length);
  if (!questions.length) return { message: 'The knowledge check is still loading. Please try again.' };
  if (missing.length) return { message: `Answer ${missing.length === 1 ? 'the remaining question' : `all ${questions.length} questions`} before checking your understanding.` };
  if (!data.authenticated) return { message: 'Your answers are ready. Sign in with your DRMZ wallet or email below to check and save them.' };
  return { action: { type: 'lesson', answers: questions.map(q => answers[q.id]) } };
}
