import React, { useState } from 'react';
import { curriculum } from '../../../lib/spaces/learning-practice.mjs';
export function PracticeSource({ id }) {
  const source = curriculum.sources.find(s => s.id === id);
  return source ? <a className="practice-source" href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a> : null;
}
export function ScenarioExercise({ kind, onSubmit, result, busy, error, onReset }) {
  const questions = curriculum[kind], [answers, setAnswers] = useState([]), [selected, setSelected] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const index = Math.min(answers.length, questions.length - 1), question = questions[index];
  if (result) return <div className="practice-results">
    <h3>{result.passed ? 'Understanding demonstrated.' : 'Review and try again.'}</h3>
    <p role="status">{result.score} / {result.total} correct · {result.passed ? 'Passed' : 'More practice needed'}</p>
    <div className="practice-feedback">{questions.map((q, i) => <details key={q.id}><summary>{i + 1}. {q.prompt}</summary><p>{q.explanation}</p><PracticeSource id={q.source}/></details>)}</div>
    <button className="button" onClick={() => { setAnswers([]); setSelected(null); setReviewing(false); onReset(); }}>Practice again</button>
  </div>;
  return <div className="practice-exercise">
    <p className="eyebrow">{kind === 'prep' ? 'QUESTION' : 'SCENARIO'} {index + 1} OF {questions.length}</p>
    <progress value={answers.length} max={questions.length} aria-label={kind === 'prep' ? 'Questions answered' : 'Scenarios answered'}/>
    <h3 className="practice-question">{question.prompt}</h3>
    <div className="practice-choices" role="group" aria-label="Choose an answer">{question.choices.map((choice, i) => <button type="button" key={choice} disabled={busy || reviewing} aria-pressed={selected === i} className={selected === i ? 'chosen' : ''} onClick={() => setSelected(i)}><span>{'ABCD'[i]}</span>{choice}</button>)}</div>
    {reviewing && <div className="sm-notice" role="status"><strong>{selected === question.correct ? 'That decision fits the evidence.' : 'Consider this before acting.'}</strong><p>{question.explanation}</p><PracticeSource id={question.source}/></div>}
    {error && <p role="alert">{error}</p>}
    <button className="button primary wide" disabled={selected === null || busy} onClick={() => { if (kind === 'challenge' && !reviewing) { setReviewing(true); return; } const next = [...answers, selected]; if (next.length === questions.length) onSubmit(next); else { setAnswers(next); setSelected(null); setReviewing(false); } }}>{busy ? 'Saving…' : kind === 'challenge' && !reviewing ? 'Review my decision' : index === questions.length - 1 ? (kind === 'prep' ? 'Check my answers' : 'Save training result') : kind === 'prep' ? 'Next question →' : 'Next scenario →'}</button>
    <p className="practice-note">Practice only. No deposit, signature or trade is required.</p>
  </div>;
}
