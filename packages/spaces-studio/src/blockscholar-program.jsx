import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { BLOCKSCHOLAR, programMilestones, nextProgramStep } from '../../../lib/blockscholar/program.mjs';
import { curriculum, emptyPractice, practiceReward } from '../../../lib/spaces/learning-practice.mjs';
import { practiceRequest, resumeGuestPreparation } from './practice-client.mjs';
import { PracticeSource, ScenarioExercise } from './practice-exercises.jsx';
import { StrikeMission, missionRequest } from './strike-mission.jsx';
import { DreamFund } from './dream-fund.jsx';
import { StrikeMarketLab } from './strike-market-lab.jsx';
import { ExposureCalculator } from './exposure-calculator.jsx';

const views = [['program', 'Program'], ['learn', 'Learn'], ['practice', 'Strike Training'], ['mission', 'Mission'], ['work', 'My work'], ['fund', 'Dream Fund']];
const blankNotes = () => ({ learning: '', application: '', artifactUrl: '' });
/** @param {{initialView?: string, compact?: boolean, signIn?: import('react').ReactNode, onPracticeChange?: (record: any) => void, onSessionChange?: (authenticated: boolean) => void, onViewChange?: (view: string) => void}} props */
export function BlockscholarProgram({ initialView = 'program', compact = false, signIn = null, onPracticeChange, onSessionChange, onViewChange }) {
  const [view, setView] = useState(views.some(([id]) => id === initialView) ? initialView : 'program');
  const [missionOpened, setMissionOpened] = useState(['mission','practice'].includes(initialView));
  const [data, setData] = useState(null), [practice, setPractice] = useState(emptyPractice()), [scope, setScope] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(''), [practiceError, setPracticeError] = useState(''), [results, setResults] = useState({});
  const [notes, setNotes] = useState(blankNotes), [dirty, setDirty] = useState(false), [noteStatus, setNoteStatus] = useState('');
  const fieldId = useId();
  const [reviewPrep, setReviewPrep] = useState(false), [reviewPractice, setReviewPractice] = useState(false), [marketOpen, setMarketOpen] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [resumeNotice, setResumeNotice] = useState('');
  useEffect(() => { onViewChange?.(view); }, [view, onViewChange]);
  const panelStart = useRef(null), navigating = useRef(false);
  const owner = useRef(undefined), pending = useRef(false), alive = useRef(true);
  const choose = next => { if (['mission','practice'].includes(next)) setMissionOpened(true); navigating.current = true; setView(next); setError(''); };
  useEffect(() => {
    if (!navigating.current) return;
    navigating.current = false;
    panelStart.current?.scrollIntoView({ block: 'start' });
    panelStart.current?.focus({ preventScroll: true });
  }, [view]);
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/learn/blockscholar', { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      const next = await response.json(); if (!response.ok) throw new Error(next.error);
      const saved = next.practice ? await resumeGuestPreparation(next.practice, next.viewer) : !next.mission.authenticated ? await practiceRequest() : { state: emptyPractice(), scope: 'account' };
      if (!alive.current) return;
      if (owner.current !== next.viewer) {
        owner.current = next.viewer; setNotes(next.mission.record?.blockscholar?.reflection || blankNotes()); setDirty(false); setNoteStatus(''); setResults({});
      }
      setData(next); setPractice(saved.state); setScope(saved.scope); setResumeNotice(saved.notice || ''); setError('');
    } catch (e) { if (alive.current) setError(e.message || 'Your program could not load. Please retry.'); }
  }, []);
  useEffect(() => {
    alive.current = true; void load();
    const refresh = () => { if (document.visibilityState === 'visible' && !pending.current) void load(); };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { alive.current = false; window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [load]);
  useEffect(() => { if (scope === 'account') onPracticeChange?.(practice); }, [practice, scope, onPracticeChange]);
  useEffect(() => { onSessionChange?.(!!data?.mission?.authenticated); }, [data?.mission?.authenticated, onSessionChange]);
  const changedMission = useCallback(mission => setData(previous => previous ? { ...previous, mission } : previous), []);
  const programAction = async (action, label) => {
    if (pending.current) return;
    pending.current = true; setBusy(label); setError(''); setNoteStatus('');
    try {
      const mission = await missionRequest(action); changedMission(mission);
      if (action.type === 'program-reflection') { setDirty(false); setNoteStatus('Field note saved to your DRMZ account.'); }
      return mission;
    } catch (e) { setError(e.message); }
    finally { pending.current = false; setBusy(''); }
  };
  const submitPractice = async action => {
    if (pending.current) return;
    pending.current = true; setBusy('Saving practice…'); setPracticeError('');
    try {
      const saved = await practiceRequest(action); setPractice(saved.state); setScope(saved.scope);
      if (saved.result) setResults(previous => ({ ...previous, [action.type]: saved.result }));
    } catch (e) { setPracticeError(e.message); }
    finally { pending.current = false; setBusy(''); }
  };
  const mission = data?.mission, record = mission?.record, enrolled = !!record?.blockscholar;
  const milestones = programMilestones(practice, record), count = milestones.filter(Boolean).length;
  const ready = practice.prepScore >= curriculum.prepPass, earned = practiceReward(practice.challengeScore), available = earned - practice.credits;
  const login = signIn || <a className="sm-primary" href={BLOCKSCHOLAR.suiteHref} target="_top">Sign in & continue in Learn →</a>;
  const edit = (key, value) => { setNotes(previous => ({ ...previous, [key]: value })); setDirty(true); setNoteStatus(''); };
  const nextStep = nextProgramStep(practice, record);
  const nextIndex = ['learn', 'mission', 'work'].indexOf(nextStep);
  const stepIndex = ['learn', 'mission', 'work'].indexOf(view);
  const continueProgram = async () => {
    if (mission.authenticated && !enrolled) {
      const saved = await programAction({ type: 'program-enroll' }, 'Joining the program…');
      if (!saved) return;
    }
    choose(nextStep);
  };
  return <section className={`strike-mission bs-suite ${compact ? 'bs-compact' : ''}`} aria-label="DRMZ Blockscholar">
    <header className="bs-header">
      <div className="bs-brandline"><div className="bs-brand"><img src="/images/nft/drmz-ouroboros-snake-only.png" width="36" height="36" alt=""/><div><span>DRMZ</span><strong>Blockscholar</strong></div></div><span className="bs-cohort">PROGRAM 01</span></div>
      <nav className="bs-nav" aria-label="Blockscholar sections">{[['program', 'Program'], ['practice', 'Strike Training'], ['work', 'My work'], ['fund', 'Dream Fund']].map(([id, name]) => <button key={id} type="button" aria-pressed={view === id || id === 'program' && ['learn', 'mission'].includes(view)} onClick={() => choose(id)}>{name}</button>)}</nav>
    </header>
    <div className="bs-panel-start" ref={panelStart} tabIndex={-1} aria-label={view === 'program' ? 'Program overview' : view === 'fund' ? 'Dream Fund' : view === 'practice' ? 'Strike Training' : `Program step ${stepIndex + 1}`}>
      {stepIndex >= 0 && <div className="bs-step-context"><button type="button" onClick={() => choose('program')}>← Program</button><span>Step {stepIndex + 1} of 3 · {['Learn', 'Workshop', 'Reflect'][stepIndex]}</span></div>}
    </div>
    {error && <div className="sm-error" role="alert">{error}<button type="button" disabled={!!busy} onClick={load}>Reload saved progress</button></div>}
    {busy && <p role="status" className="sm-status">{busy}</p>}
    {!data && !error && <div className="bs-skeleton" role="status">Loading your program…</div>}
    {mission && !mission.enabled && <div className="sm-card"><h2>This program is a local testnet pilot.</h2><p>It has not been enabled on this deployment.</p><a href="/learn/blockscholar" target="_top">Return to Learn</a></div>}
    {mission?.enabled && <>
      <section className="bs-panel" hidden={view !== 'program'} aria-label="Program overview">
        <div className="bs-program-intro">
          <p className="sm-step-label">LEARN. PRACTICE. PUT IT TO WORK.</p>
          <h1>{BLOCKSCHOLAR.title}</h1>
          <p>Understand the risks. Try a real workflow on Strike testnet. Leave with evidence of what you can do.</p>
          <div className="bs-partner"><span>Supported by DRMZ stake pool</span><img src="/images/brands/strike-finance-logo-white.svg" alt="Strike Finance" width="80" height="28"/></div>
        </div>
        <article className="sm-card bs-resume">
          <span className="sm-step-label">{count === 3 ? 'PROGRAM COMPLETE' : `YOUR NEXT STEP · ${nextIndex + 1} OF 3`}</span>
          <h2>{count === 3 ? 'Your work is saved.' : BLOCKSCHOLAR.outcomes[nextIndex].title}</h2>
          <p>{count === 3 ? 'Review your learning record and revisit any step.' : BLOCKSCHOLAR.outcomes[nextIndex].evidence}</p>
          <button className="sm-primary" type="button" disabled={!!busy} onClick={continueProgram}>{count === 3 ? 'View my work' : mission.authenticated && !enrolled ? 'Join & continue →' : 'Continue →'}</button>
          <div className="bs-progress-caption"><span>{mission.authenticated ? `${count} of 3 milestones saved${scope === 'device' ? ' · quiz on this browser' : ''}` : count ? 'Quiz saved in this browser · sign in for the workshop' : 'Explore now · sign in to save your program'}</span><progress value={count} max="3" aria-label="Program milestones saved"/></div>
        </article>
        {!mission.authenticated && <div className="bs-access"><button type="button" className="bs-text-button" aria-expanded={showSignIn} onClick={() => setShowSignIn(!showSignIn)}>Already started? Sign in to resume</button>{showSignIn && <div className="bs-signin"><p>Use your DRMZ wallet or email.</p>{view === 'program' && login}</div>}</div>}
        <ol className="bs-path" aria-label="Your program path">{BLOCKSCHOLAR.outcomes.map((outcome, i) => <li key={outcome.title}><span className={milestones[i] ? 'bs-check done' : 'bs-check'} aria-label={milestones[i] ? 'Saved' : 'Not yet saved'}>{milestones[i] ? '✓' : `0${i + 1}`}</span><button type="button" onClick={() => choose(['learn', 'mission', 'work'][i])}><strong>{['Learn the essentials', 'Enter the Strike workshop', 'Write your field note'][i]}</strong><span>{['Six lessons together, then one quiz', 'Set up, fund, then practice an order', 'Connect the skill to your work'][i]}</span></button></li>)}</ol>
        <div className="bs-program-footnote"><p>Self-paced · no enrollment fee · testnet only</p><p>Dream Fund supports a <strong>2 test-ADA bounty</strong> for a verified mission, subject to available funding.</p><button className="bs-text-button" type="button" onClick={() => choose('fund')}>See the Dream Fund →</button></div>
      </section>
      <section className="bs-panel" hidden={view !== 'learn'} aria-label="Strike lessons">
        <div className="bs-section-intro"><span className="sm-step-label">THE ESSENTIALS</span><h2>Understand it. Then try it.</h2><p>Six short lessons, one quiz. Everything you need before the workshop, together on this page.</p><a className="bs-text-button" href={`#${fieldId}-quiz`}>{ready ? 'Go to your saved quiz result ↓' : 'Go to the quiz ↓'}</a></div>
        <div className="bs-lesson-stack">{curriculum.lessons.map((lesson, i) => <article className="sm-card bs-reader" key={lesson.id}><p className="sm-step-label">{String(i + 1).padStart(2, '0')} / {curriculum.lessons.length}</p><h2>{lesson.title}</h2><p className="bs-lesson-body">{lesson.body}</p>{lesson.id === 'mechanics' && <ExposureCalculator/>}<PracticeSource id={lesson.source}/></article>)}</div>
        <article className="sm-card bs-quiz" id={`${fieldId}-quiz`}>
          <span className="sm-step-label">ONE KNOWLEDGE CHECK</span><h2>{ready && !reviewPrep ? 'Ready for the workshop.' : 'Check your understanding.'}</h2>
          {ready && !reviewPrep ? <><p>Your saved best score is {practice.prepScore} of 8.</p><div className="bs-next-actions"><button className="sm-primary" type="button" onClick={() => choose('mission')}>Enter the workshop →</button><button className="bs-text-button" type="button" onClick={() => setReviewPrep(true)}>Try the quiz again</button></div></> : <><p>Eight questions about perpetuals and Strike. Pass six; your best score is kept.</p><ScenarioExercise kind="prep" result={results.prep} onSubmit={answers => submitPractice({ type: 'prep', answers })} busy={!!busy} error={practiceError} onReset={() => setResults(previous => ({ ...previous, prep: null }))}/>{ready && <div className="bs-next-actions"><button className="sm-primary" type="button" onClick={() => choose('mission')}>Enter the workshop →</button></div>}</>}
          <p className="sm-small">{scope === 'account' ? 'Saved to your DRMZ account.' : 'Guest practice is saved in this browser. Sign in to save the workshop to your account.'}</p>
        </article>
      </section>
      <section className="bs-panel" hidden={view !== 'practice'} aria-label="Strike Training">
        <div className="bs-section-intro"><span className="sm-step-label">OPTIONAL · RETURN ANYTIME</span><h2>Strike Training</h2><p>Learn the direction. Open a small test position. Close it and keep the verified evidence. Your existing wallet and workshop progress stay with you.</p></div>
      </section>
      <section className="bs-panel bs-mission-panel" hidden={view !== 'mission' && view !== 'practice'} aria-label="Verified Strike mission">
        {view === 'mission' && resumeNotice && <p className="sm-small" role="status">{resumeNotice}</p>}
        {missionOpened && <StrikeMission compact embedded positionMode={view === 'practice'} signIn={['mission','practice'].includes(view) ? login : null} onChange={changedMission}/>}
        {view === 'mission' && record?.completedAt && <div className="bs-next-actions"><button type="button" className="sm-primary" onClick={() => choose('practice')}>Practice a long or short →</button><button className="sm-primary" type="button" onClick={() => choose('work')}>Continue to your field note →</button></div>}
      </section>
      <section className="bs-panel" hidden={view !== 'practice'}><details className="bs-disclosure"><summary>More scenarios & market practice</summary>
        <article className="sm-card"><h3>Exposure, costs and changing orders</h3><p>Work through four situations: a price move, a funding bill, a risk decision and a partial fill.</p>
          {ready ? <>{practice.challengeScore >= 3 && !reviewPractice ? <><p>Best result: {practice.challengeScore} of 4. Your workshop is available independently of this score.</p><button className="sm-primary" type="button" onClick={() => setReviewPractice(true)}>Train again</button></> : <ScenarioExercise kind="challenge" result={results.challenge} busy={!!busy} error={practiceError} onSubmit={answers => submitPractice({ type: 'challenge', answers })} onReset={() => setResults(previous => ({ ...previous, challenge: null }))}/>}</> : <><p>Complete the essentials quiz first to save your scenario practice.</p><button className="sm-primary" type="button" onClick={() => choose('learn')}>Open the essentials →</button></>}
        </article>
        <details className="bs-disclosure" onToggle={e => setMarketOpen(e.currentTarget.open)}><summary>Explore current Strike testnet markets</summary><StrikeMarketLab active={view === 'practice' && marketOpen}/></details>
        {earned > 0 && <details className="bs-disclosure"><summary>Your practice credits · {practice.credits}</summary><p className="sm-small">Recognition for practice, with no monetary value. Separate from the verified mission’s test-ADA bounty.</p><button type="button" disabled={!!busy || available <= 0} onClick={() => submitPractice({ type: 'claim' })}>{available > 0 ? `Collect ${available} practice credits` : 'Practice credits collected'}</button>{practiceError && <p role="alert">{practiceError}</p>}</details>}
        <div className="bs-next-actions"><button type="button" className="bs-text-button" onClick={() => choose('mission')}>Back to the Strike workshop →</button></div>
      </details></section>
      <section className="bs-panel" hidden={view !== 'work'} aria-label="My work and evidence">
        <article className="sm-card bs-notes">
          <span className="sm-step-label">YOUR LEARNING JOURNAL</span><h2>Your field note</h2>
          <p className="sm-small">Connect what you practiced to something you could do at work. Your note is saved to your account.</p>
          {!enrolled ? <div className="bs-note-start"><p>{mission.authenticated ? 'Join the DRMZ program to start your field note.' : 'Sign in and join the program to write and save your field note.'}</p><button type="button" className="sm-primary" disabled={!!busy} onClick={() => mission.authenticated ? programAction({ type: 'program-enroll' }, 'Joining the program…') : (setShowSignIn(true), choose('program'))}>{mission.authenticated ? 'Join & start writing' : 'Go to program sign-in'}</button></div> : <form onSubmit={e => { e.preventDefault(); void programAction({ type: 'program-reflection', learning: notes.learning, application: notes.application, artifactUrl: notes.artifactUrl.trim() }, 'Saving your field note…'); }}>
            <div className="bs-field"><label htmlFor={`${fieldId}-learning`}>What did you learn?</label><p id={`${fieldId}-learning-help`} className="bs-field-help">Describe a decision you made and the evidence you checked. At least 30 characters.</p><textarea id={`${fieldId}-learning`} aria-describedby={`${fieldId}-learning-help`} required minLength={30} maxLength={2000} rows={5} value={notes.learning} onChange={e => edit('learning', e.target.value)} placeholder="I checked… I chose… I learned…" disabled={!!busy}/><span className="bs-field-count">{notes.learning.length}/2,000</span></div>
            <div className="bs-field"><label htmlFor={`${fieldId}-application`}>Where could you use it?</label><p id={`${fieldId}-application-help`} className="bs-field-help">Connect the skill to a workplace task. At least 30 characters.</p><textarea id={`${fieldId}-application`} aria-describedby={`${fieldId}-application-help`} required minLength={30} maxLength={2000} rows={5} value={notes.application} onChange={e => edit('application', e.target.value)} placeholder="I could use this when…" disabled={!!busy}/><span className="bs-field-count">{notes.application.length}/2,000</span></div>
            <div className="bs-field"><label htmlFor={`${fieldId}-artifact`}>Link to your work <span>(optional)</span></label><input id={`${fieldId}-artifact`} type="url" inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={1000} value={notes.artifactUrl} onChange={e => edit('artifactUrl', e.target.value)} placeholder="https://example.com/my-work" disabled={!!busy}/></div>
            <div className="bs-note-actions"><button className="sm-primary" type="submit" disabled={!!busy || !dirty}>{busy === 'Saving your field note…' ? 'Saving your field note…' : 'Save field note'}</button><p className="sm-small" role="status">{dirty ? 'Unsaved changes · save before leaving' : noteStatus || (record?.blockscholar?.reflection ? `Saved ${new Date(record.blockscholar.reflection.savedAt).toLocaleString()}` : 'Ready when you are.')}</p></div>
            <p className="sm-small bs-note-privacy">Keep wallet secrets and confidential student or employer information out of your note. This reflection is not a reviewed credential or an additional bounty.</p>
          </form>}
        </article>
        <details className="bs-disclosure"><summary>Your saved evidence</summary><dl className="bs-ledger"><div><dt>Preparation</dt><dd>{practice.prepScore}/8</dd></div><div><dt>Optional Strike Training</dt><dd>{practice.challengeScore}/4</dd></div><div><dt>Strike mission</dt><dd>{record?.completedAt ? 'Verified through Strike API' : 'Not yet verified'}</dd></div>{['long','short'].map(direction => <div key={direction}><dt>{direction === 'long' ? 'Long mission' : 'Short mission'}</dt><dd>{record?.positions?.[direction]?.completedAt ? 'Entry and close verified through Strike API' : record?.positions?.[direction]?.scenarioAt ? 'In progress · scenario saved' : 'Not started'}</dd></div>)}<div><dt>Learning bounty</dt><dd>{record?.claim?.status === 'confirmed' ? 'Confirmed on Preprod' : record?.claim?.status === 'submitted' ? 'Awaiting confirmation' : 'Not paid'}</dd></div></dl>{record?.receipt && <details><summary>View mission evidence digest</summary><code className="bs-address">{record.receipt}</code><p className="sm-small">DRMZ’s digest of verified API evidence. This is not a ZK proof or an accredited credential.</p></details>}{record?.claim?.txHash && <a href={`https://preprod.cardanoscan.io/transaction/${record.claim.txHash}`} target="_blank" rel="noreferrer">View your bounty transaction ↗</a>}</details>

        {count === 3 && <div className="bs-next-actions"><p className="sm-success" role="status">✓ Your Blockscholar program is complete. Your lessons, verified mission and field note are saved.</p><button type="button" className="sm-primary" onClick={() => choose('practice')}>Continue with Strike Training →</button></div>}
      </section>
      <section className="bs-panel" hidden={view !== 'fund'}><DreamFund active={view === 'fund'}/></section>
    </>}
    <footer className="sm-footer bs-footer"><a href="/learn/blockscholar" target="_top">← Learn</a><a href={BLOCKSCHOLAR.worldHref} target="_top">Explore DRMZ Spaces ↗</a></footer>
    <p className="bs-pilot-note">Independent DRMZ pilot. Test ADA has no monetary value. No college credit or district endorsement is implied.</p>
  </section>;
}
