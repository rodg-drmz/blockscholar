import React, { useEffect, useRef, useState } from 'react';
import { missionRequest } from './strike-mission.jsx';

export function FieldNoteReward({ mission, dirty, onChange, onMission }) {
  const record = mission?.record, claim = record?.fieldNoteClaim;
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const check = async receipt => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try { const result = await missionRequest({ type: receipt ? 'field-note-receipt' : 'field-note-claim' }); if (mounted.current) onChange(result); }
    catch (e) {
      // Recover a durable outbox even when the network lost the submission response.
      const saved = await missionRequest().catch(() => null);
      if (mounted.current) { if (saved) onChange(saved); setError(e.message || 'Your saved claim can be checked again.'); }
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const latest = useRef(check); latest.current = check;
  useEffect(() => {
    if (claim?.status !== 'submitted') return;
    const checkVisible = () => { if (document.visibilityState === 'visible') void latest.current(true); };
    const timer = setInterval(checkVisible, 15_000);
    window.addEventListener('focus', checkVisible);
    return () => { clearInterval(timer); window.removeEventListener('focus', checkVisible); };
  }, [claim?.status, claim?.txHash]);
  if (!record?.blockscholar?.reflection) return null;
  return <section className="sm-card bs-field-reward" aria-label="Final field-note bounty">
    <span className="sm-step-label">FINAL STEP</span>
    <h2>{claim?.status === 'confirmed' ? 'Activity complete.' : 'Claim your final 3 test ADA.'}</h2>
    {claim?.status === 'confirmed' ? <p className="sm-success" role="status">✓ 5 test ADA earned: 2 for the verified mission + 3 for your field note. Your work and both receipts are saved.</p> : record.claim?.status !== 'confirmed' ? <><p>Your field note is saved. Confirm the first 2-test-ADA mission bounty, then return for your final reward.</p><button className="sm-primary" type="button" onClick={onMission}>Go to your mission bounty →</button></> : <>
      <p>Your note is saved. The final reward goes to the same Preprod wallet as your mission bounty.</p>
      <button className="sm-primary" type="button" disabled={busy || dirty || !mission.reward?.configured} onClick={() => check(!!claim?.txHash)}>{busy ? 'Checking your reward…' : claim?.txHash ? 'Check final payment' : 'Claim 3 test ADA & finish'}</button>
      {dirty && <p className="sm-small">Save your latest edits before claiming.</p>}
      {!mission.reward?.configured && <p className="sm-small">Sponsor funding is unavailable. Your field note remains saved.</p>}
      {claim?.status === 'submitted' && <p role="status">Payment submitted. Checking Preprod confirmation automatically.</p>}
      <p className="sm-small">One field-note reward per learner and wallet. DRMZ covers the fee.</p>
    </>}
    {busy && <p className="sm-status" role="status">Checking your saved reward transaction…</p>}
    {error && <p className="sm-error" role="alert">{error}</p>}
    {claim?.txHash && <a className="bs-text-button" href={`https://preprod.cardanoscan.io/transaction/${claim.txHash}`} target="_blank" rel="noreferrer">View final reward receipt ↗</a>}
  </section>;
}
