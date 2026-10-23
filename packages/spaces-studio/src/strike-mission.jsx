import React, { useCallback, useEffect, useRef, useState } from 'react';
import { newStrikeSession, signTestOrder, signDepositRequest, connectionAddress, walletRequest, inspectWalletAccount, assertWalletAccount } from './strike-session.mjs';
import { lessonSubmission } from './mission-check.mjs';
import { reconcileDeposit } from './deposit-progress.mjs';
import { StrikeWalletSetup } from './strike-wallet-setup.jsx';
import { StrikeWorkshopGuide } from './strike-workshop-guide.jsx';
import { StrikePositionMissions } from './strike-position-missions.jsx';

const endpoint = '/api/learn/strike-mission';
export async function missionRequest(action) {
  const response = await fetch(endpoint, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(action?.type === 'claim' || action?.type === 'receipt' || action?.type?.startsWith('practice-') || action?.type?.startsWith('deposit-') ? 95_000 : 35_000), ...(action ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action) } : {}) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'The mission could not update. Please retry.'), { status: response.status });
  return data;
}
const short = text => text ? `${text.slice(0, 20)}…${text.slice(-8)}` : '';
function walletProviders() {
  let source = window.cardano;
  try { source ||= window.parent?.cardano; } catch { /* Standalone page. */ }
  const names = new Set();
  return Object.entries(source || {}).filter(([, value]) => {
    if (typeof value?.enable !== 'function') return false;
    const name = String(value.name || '').toLowerCase();
    if (name && names.has(name)) return false;
    if (name) names.add(name);
    return true;
  }).map(([id, value]) => ({ id, name: value.name || id, provider: value }));
}
/** @param {{signIn?: import('react').ReactNode, compact?: boolean, embedded?: boolean, positionMode?:boolean, onChange?: (data: any) => void}} props */
export function StrikeMission({ signIn = null, compact = false, embedded = false, positionMode=false, onChange }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(''), [answers, setAnswers] = useState({}), [orderId, setOrderId] = useState('');
  const [wallets, setWallets] = useState([]), [walletId, setWalletId] = useState('');
  const [approvalName, setApprovalName] = useState('');
  const [approvalPlace, setApprovalPlace] = useState('connect');
  const [setupCheck, setSetupCheck] = useState({checking:false, checkedAt:null, warning:''});
  const [walletDiagnostic, setWalletDiagnostic] = useState(null);
  const [showRestart, setShowRestart] = useState(false);
  const preparedConnection = useRef(null);
  const [lessonFeedback, setLessonFeedback] = useState('');
  const [replaceOrder, setReplaceOrder] = useState(false);
  const [funding, setFunding] = useState(null);
  const [reviewSetup, setReviewSetup] = useState(false);
  const feedbackRef = useRef(null), connectRef = useRef(null), stageRef = useRef(null);
  const pending = useRef(false), mounted = useRef(true), strikeSession = useRef(null), practiceSession = useRef(null);
  useEffect(() => { if (data) onChange?.(data); }, [data, onChange]);
  const refresh = useCallback(async (clearError = true) => {
    try { const value = await missionRequest(); if (mounted.current) { setData(value); if (clearError) setError(''); } }
    catch (e) { if (mounted.current) setError(e.name === 'TimeoutError' ? 'Connection timed out. Your saved progress is unchanged.' : e.message); }
  }, []);
  useEffect(() => {
    mounted.current = true; void refresh();
    const update = () => { if (document.visibilityState === 'visible') { setWallets(walletProviders()); if (!pending.current) void refresh(false); } };
    setWallets(walletProviders()); const timer = setTimeout(() => setWallets(walletProviders()), 1500);
    window.addEventListener('focus', update); document.addEventListener('visibilitychange', update);
    return () => { mounted.current = false; clearTimeout(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, [refresh]);
  const paymentHash = data?.record?.claim?.txHash;
  const paymentStatus = data?.record?.claim?.status;
  useEffect(() => {
    if (!paymentHash || paymentStatus !== 'submitted') return;
    // Follow the durable receipt while visible; no new payout is created on retry.
    const stopAt = Date.now() + 5 * 60_000;
    const timer = setInterval(async () => {
      if (Date.now() > stopAt) { clearInterval(timer); return; }
      if (pending.current || document.visibilityState !== 'visible') return;
      pending.current = true; setBusy('Checking bounty confirmation…');
      try {
        const saved = await missionRequest({ type: 'receipt' });
        // A successful retry replaces the earlier network warning as well as the receipt.
        if (mounted.current) { setData(saved); setError(''); }
      }
      catch { /* Keep the saved receipt and manual Check payment control available. */ }
      finally { pending.current = false; if (mounted.current) setBusy(''); }
    }, 15_000);
    return () => clearInterval(timer);
  }, [paymentHash, paymentStatus]);
  const run = async (label, fn) => {
    if (pending.current) return;
    pending.current = true; setBusy(label); setError('');
    try { const result = await fn(); if (mounted.current) { setData(result); if (result.funding) setFunding({ ...result.funding, accountId: result.funding.accountId || result.record?.accountId }); } }
    catch (e) {
      // Reload the durable record, including a payout saved before a network timeout.
      const saved = await missionRequest().catch(() => null);
      if (mounted.current) { if (saved) setData(saved); setError(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'The request took too long. Your saved progress is safe; check again.' : e?.message || 'The wallet request was not completed. Please retry.'); }
    } finally { pending.current = false; if (mounted.current) setBusy(''); }
  };
  const act = (action, label) => run(label, () => missionRequest(action));
  const switchAttempt = attemptId => run(attemptId ? 'Restoring your saved practice…' : 'Starting a fresh practice workspace…', async () => {
    const result = await missionRequest({type:attemptId ? 'practice-restore' : 'practice-restart',expectedUpdatedAt:data.record.updatedAt,...(attemptId ? {attemptId} : {})});
    strikeSession.current=null; practiceSession.current=null; preparedConnection.current=null;
    setApprovalName(''); setWalletDiagnostic(null); setFunding(null); setReviewSetup(false); setReplaceOrder(false); setShowRestart(false);
    return result;
  });
  const checkUnderstanding = async event => {
    event.preventDefault();
    if (pending.current) return;
    setLessonFeedback('');
    const submission = lessonSubmission(data, answers);
    if (submission.message) { setLessonFeedback(submission.message); return; }
    pending.current = true; setBusy('Checking your answers…'); setError('');
    try { const result = await missionRequest(submission.action); if (mounted.current) setData(result); }
    catch (e) {
      if (mounted.current) {
        setLessonFeedback(e.name === 'TimeoutError' || e.name === 'AbortError' ? 'The check took too long. Your answers are still here. Try again to check your saved result.' : e.message);
        if (e.status === 401) setData(previous => ({ ...previous, authenticated: false, record: null }));
      }
    } finally { pending.current = false; if (mounted.current) setBusy(''); }
  };
  useEffect(() => { if (lessonFeedback) feedbackRef.current?.focus({ preventScroll: true }); }, [lessonFeedback]);
  const setupSession = (record = data?.record) => [practiceSession.current, strikeSession.current].find(s => s?.publicKey && s.publicKey === (record?.practiceConnection?.apiPublicKey || record?.apiPublicKey));
  const tradingSession = () => [strikeSession.current, practiceSession.current].find(s => s?.publicKey && s.publicKey === data?.record?.apiPublicKey);
  const inspectConnection = () => run('Checking wallet account…', async () => {
    const choices = walletProviders();
    const wallet = choices.find(w => w.id === walletId);
    if (!wallet) throw new Error('Select your Cardano wallet first.');
    const api = await walletRequest('enable', () => wallet.provider.enable());
    const network = await walletRequest('network', () => api.getNetworkId());
    const details = await inspectWalletAccount(api, data?.record?.wallet);
    setWalletDiagnostic({ ...details, name:wallet.name, network });
    return missionRequest();
  });
  const connect = (purpose, place = purpose === 'practice' ? 'setup' : purpose === 'reward' ? 'reward' : purpose === 'strike' ? 'external' : 'connect') => run('Connecting wallet…', async () => {
    setApprovalPlace(place);
    preparedConnection.current = null; setApprovalName('');
    const choices = walletProviders(); setWallets(choices);
    const wallet = choices.find(w => w.id === walletId);
    if (!wallet) throw new Error('Choose the wallet you want to use for practice. On a phone, open this page inside that wallet’s browser. Your DRMZ sign-in stays active.');
    const api = await walletRequest('enable', () => wallet.provider.enable());
    if ((purpose === 'reward' || purpose === 'builder' || purpose === 'practice') && await walletRequest('network', () => api.getNetworkId()) !== 0) throw new Error('Switch your Cardano wallet to Preprod for this practice workspace.');
    const address = await walletRequest('address', () => connectionAddress(api, purpose, data?.record));
    if (purpose === 'builder' && data?.record?.wallet) {
      const details = await inspectWalletAccount(api, address);
      setWalletDiagnostic({...details, name:wallet.name, network:0});
      assertWalletAccount(details, address);
    }
    const session = purpose === 'builder' || purpose === 'practice' ? newStrikeSession() : null;
    const check = await missionRequest(session ? { type: 'builder-challenge', address, publicKey: session.publicKey, ...(purpose === 'practice' ? {context:'practice'} : {}) } : { type: 'challenge', purpose, address });
    // Prepare first; signing starts only from the next direct button click.
    // Some wallet surfaces fail to show a request after an async server round trip.
    preparedConnection.current = {api, session, check, purpose, name:wallet.name, expires:Date.now()+180_000};
    setApprovalName(wallet.name);
    return check;
  });
  const approveConnection = () => run('Opening wallet approval…', async () => {
    const prepared = preparedConnection.current;
    preparedConnection.current = null; setApprovalName('');
    if (!prepared || prepared.expires <= Date.now()) throw new Error('The connection request expired. Reconnect to prepare a fresh message. Your progress is saved.');
    const {api, session, check, purpose, name} = prepared;
    setBusy(`Open ${name} and approve the Strike testnet connection message. Waiting for your approval…`);
    const proof = await walletRequest('sign', () => api.signData(check.challenge.addressHex, check.challenge.hex));
    setBusy('Verifying your Strike testnet connection…');
    const result = await missionRequest({ type: session ? 'builder-connect' : 'link', proof });
    if (session) { if (purpose === 'practice' && result.record?.practiceConnection) practiceSession.current = session; else strikeSession.current = session; }
    if (purpose !== 'reward') {
      // A balance-read outage must not turn a successful connection into a failed login.
      return await missionRequest({ type: purpose === 'practice' ? 'practice-account-check' : 'account-check' }).catch(() => result);
    }
    return result;
  });
  const trade = operation => run(operation === 'place' ? 'Sending the reviewed testnet order…' : 'Requesting cancellation…', async () => {
    const session = tradingSession();
    if (!session || session.publicKey !== data.record.apiPublicKey) throw new Error('Reconnect Strike testnet in this tab before trading. Your mission progress is saved.');
    const body = operation === 'place' ? data.record.trade.body : JSON.stringify({ symbol: 'ETH-USD', client_order_id: data.record.trade.clientId });
    const clock = await missionRequest({ type: 'trade-clock' });
    return missionRequest({ type: 'trade-submit', operation, headers: signTestOrder(session, operation, body, clock.serverTime) });
  });
  const positionTrade=(direction,operation,request)=>run('Sending your reviewed testnet request…',async()=>{
    const session=tradingSession();
    if(!session) throw new Error('Reconnect the same Strike wallet in this tab before trading. Your progress is saved.');
    const clock=await missionRequest({type:'trade-clock'});
    return missionRequest({type:'position-submit',direction,operation,clientId:request.clientId,headers:signTestOrder(session,'place',request.body,clock.serverTime)});
  });
  const sendDepositRequest = async operation => {
    const session = setupSession();
    if (!session) throw new Error('Reconnect Strike in this tab to resume your saved deposit.');
    let walletUtxos;
    if(operation==='build') {
      const wallet=walletProviders().find(w=>w.id===walletId);
      if(!wallet) throw new Error('Choose your connected Preprod wallet before reviewing the deposit.');
      const api=await walletRequest('enable',()=>wallet.provider.enable());
      if(await walletRequest('network',()=>api.getNetworkId())!==0) throw new Error('Switch the practice wallet to Cardano Preprod.');
      // CIP-30 coin selection covers all wallet addresses, including token-bearing inputs.
      walletUtxos=await walletRequest('inputs',()=>api.getUtxos('1a'+(103_000_000).toString(16).padStart(8,'0')));
      if(!Array.isArray(walletUtxos) || !walletUtxos.length) throw new Error('The wallet could not select enough spendable Preprod inputs. Refresh its balance, or continue with your existing Strike balance.');
      if(walletUtxos.length>20 || JSON.stringify(walletUtxos).length>20_000) throw new Error('The wallet selected too many inputs for this deposit. Consolidate test funds in the wallet, or use your existing Strike balance.');
    }
    const planned = await missionRequest({type:'deposit-plan', operation,...(walletUtxos ? {walletUtxos} : {})});
    return missionRequest({type:'deposit-request', id:planned.depositPlan.id, headers:signDepositRequest(session, planned.depositPlan)});
  };
  const deposit = operation => run(operation === 'quote' ? 'Getting your testnet deposit quote…' : operation === 'build' ? 'Checking the deposit transaction…' : 'Requesting Strike test credit…', () => sendDepositRequest(operation));
  const signDeposit = () => run('Review and approve the test-ADA deposit in your wallet…', async () => {
    const wallet = walletProviders().find(w => w.id === walletId);
    if (!wallet) throw new Error('Open this page in the Cardano wallet you linked to Strike.');
    const waitForWallet = promise => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Wallet response timed out. Your deposit has not been submitted; unlock the wallet and retry.')), 90_000); Promise.resolve(promise).then(resolve,reject).finally(() => clearTimeout(timer)); });
    const api = await waitForWallet(wallet.provider.enable());
    if (await waitForWallet(api.getNetworkId()) !== 0) throw new Error('Switch your wallet to Preprod. This deposit uses test ADA only.');
    const d = data.record.deposit;
    if (!d || d.status !== 'built' || d.expires <= Date.now()) throw new Error('This quote expired. Refresh it before approving the deposit.');
    const witnesses = await waitForWallet(api.signTx(d.unsignedTx, true));
    setBusy('Saving and submitting your signed Preprod deposit…');
    const result = await missionRequest({type:'deposit-submit', txHash:d.txHash, witnesses});
    setData(result);
    if (!setupSession(result.record)) return result;
    setBusy('Requesting Strike test credit…');
    return sendDepositRequest('confirm');
  });
  const grantStatus = data?.record?.practiceGrant?.status, depositStatus = data?.record?.deposit?.status;
  useEffect(() => {
    if (grantStatus !== 'submitted' && !['submitted','registered'].includes(depositStatus)) return;
    let disposed = false;
    const check = async () => {
      if (pending.current || document.visibilityState !== 'visible') return;
      pending.current = true;
      setSetupCheck(previous => ({...previous, checking:true}));
      try {
        const outcome = grantStatus === 'submitted'
          ? {result:await missionRequest({type:'practice-check'}), warning:''}
          : await reconcileDeposit({check:() => missionRequest({type:'deposit-check'}), read:() => missionRequest(), register:setupSession() ? () => sendDepositRequest('confirm') : undefined});
        if (mounted.current && !disposed) {
          setData(outcome.result); setError('');
          if (outcome.result.funding) setFunding(outcome.result.funding);
          setSetupCheck({checking:false, checkedAt:Date.now(), warning:outcome.warning});
        }
      } catch (error) {
        if (mounted.current && !disposed) setSetupCheck(previous => ({...previous, checking:false, warning:error?.message || 'Connection interrupted. Check again.'}));
      } finally { pending.current = false; }
    };
    const first = setTimeout(check, 500);
    const timer = setInterval(check, 20_000);
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', check);
    return () => { disposed = true; clearTimeout(first); clearInterval(timer); window.removeEventListener('focus',check); document.removeEventListener('visibilitychange',check); };
  }, [grantStatus, depositStatus, data?.record?.apiPublicKey, data?.record?.practiceConnection?.apiPublicKey]);
  const r = data?.record || {}, completed = !!r.completedAt, paid = r.claim?.status === 'confirmed';
  const steps = [!!r.lessonAt, !!r.accountId, !!r.order, completed, paid];
  const fundingChecked = !!r.accountId && !!funding && funding.accountId === r.accountId;
  const setupReady = r.deposit?.status === 'verified' || r.practiceExistingAt || r.order || r.trade || completed;
  const stage = !r.accountId ? 1 : reviewSetup || !setupReady ? 5 : !r.lessonAt ? 0 : !completed && (!r.order || replaceOrder) ? 2 : !completed ? 3 : 4;
  useEffect(() => { setReplaceOrder(false); }, [r.order?.id, r.accountId, completed]);
  useEffect(() => { if (embedded && data) stageRef.current?.focus({ preventScroll: true }); }, [stage, embedded]);
  const reconnect = embedded && stage > 1 && stage < 4 && r.accountId && !tradingSession();
  const walletChoice = <div className="sm-wallet"><label>Cardano wallet<select aria-label="Cardano wallet" value={walletId} onChange={e => { setWalletId(e.target.value); preparedConnection.current=null; setApprovalName(''); }} disabled={!!busy}><option value="">{wallets.length ? 'Choose a wallet' : 'Open in a Cardano wallet browser'}</option>{wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label><button type="button" disabled={!!busy} onClick={() => setWallets(walletProviders())}>Find wallets</button></div>;
  const approvalFor = place => approvalName && approvalPlace === place ? <div className="sm-inline-approval" role="status"><p>Confirm the connection in {approvalName}.</p><div className="sm-action-row"><button type="button" className="sm-primary" disabled={!!busy} onClick={approveConnection}>Approve in {approvalName}</button><button type="button" className="bs-text-button" disabled={!!busy} onClick={() => { preparedConnection.current=null; setApprovalName(''); }}>Cancel</button></div></div> : null;
  const connectionPanel = reconnect ? <details className="sm-reconnect"><summary>Reconnect your practice wallet to continue</summary><p>Use your linked wallet to authorize testnet orders in this tab. Your progress is saved.</p>{walletChoice}<div className="sm-action-row"><button type="button" className="sm-primary" disabled={!!busy || !walletId} onClick={() => connect('builder','reconnect')}>Reconnect Strike testnet</button>{approvalFor('reconnect')}<button type="button" disabled={!!busy || !walletId} onClick={inspectConnection}>Check wallet connection</button></div>{walletDiagnostic && <details><summary>Connection details</summary><p>{walletDiagnostic.name} · {walletDiagnostic.network === 0 ? 'Test network' : 'Mainnet'}</p><p>Funded address listed: {walletDiagnostic.savedAddressListed === null ? 'unknown' : walletDiagnostic.savedAddressListed ? 'yes' : 'no'}. Same staking key: {walletDiagnostic.sameStakeKey === null ? 'unknown' : walletDiagnostic.sameStakeKey ? 'yes' : 'no'}. Unavailable address checks: {walletDiagnostic.unavailableReads}.</p><p>This check does not sign, deposit, or change your linked account.</p></details>}</details> : null;
  return <section className={`strike-mission ${compact ? 'sm-compact' : ''}`} aria-label="Strike testnet mission">
    {!embedded && <header className="sm-hero">
      <div className="sm-kicker"><span className="sm-live-dot"/> STRIKE LAB / MISSION 01</div>
      {embedded ? <h2>Learn the order.<br/><em>Own the decision.</em></h2> : <h1>Learn the order.<br/><em>Own the decision.</em></h1>}
      <p>Place, inspect, and cancel a limit order on Strike testnet. Bring back the evidence. Claim your learning bounty.</p>
      <div className="sm-pills"><span>Strike testnet</span><span>2 test ADA · Preprod</span><span>{data?.authenticated ? 'Saved to your DRMZ account' : 'Sign in to save progress'}</span></div>
    </header>}
    {!embedded && <ol className="sm-progress" aria-label="Mission progress">{['Learn', 'Connect', 'Inspect', 'Verify', 'Claim'].map((name, i) => <li key={name} className={steps[i] ? 'sm-done' : ''}><span aria-hidden>{steps[i] ? '✓' : `0${i + 1}`}</span>{name}<span className="sm-sr-only">{steps[i] ? ' complete' : ' not complete'}</span></li>)}</ol>}
    {error && <div className="sm-error" role="alert">{error}<button type="button" disabled={!!busy} onClick={refresh}>Reload saved record</button></div>}
    {busy && <p className="sm-status" role="status">{busy}</p>}
    {!data && !error && <p role="status">Loading your mission…</p>}
    {data && !data.enabled && <div className="sm-card"><h2>This testnet mission is not enabled here yet.</h2><p>Your existing Learn progress is unchanged.</p></div>}
    {data?.enabled && <>
      {!data.authenticated && <div className="sm-card sm-signin">{signIn || <a className="sm-primary" href="/learn/quests/strike-mission" target="_top">Sign in & continue →</a>}</div>}
      {data.authenticated && <>
      {positionMode && <StrikePositionMissions data={data} busy={busy} act={act} submit={positionTrade} connected={!!tradingSession()} connection={<div className="sm-notice"><p>Reconnect your existing funded wallet to authorize practice trades in this tab.</p>{walletChoice}<button type="button" className="sm-primary" disabled={!!busy || !walletId} onClick={()=>connect('builder','position')}>Reconnect same Strike account</button>{approvalFor('position')}</div>}/>}
      <div hidden={positionMode}>

      {embedded && <header ref={stageRef} tabIndex={-1} className="bs-workshop-heading">
        <span className="sm-step-label">STRIKE TESTNET · WORKSHOP</span>
        {stage !== 5 && <h2>{['Before you place an order.', 'Your testnet workspace.', 'Observe a real order.', 'Cancel. Then confirm.', paid ? 'Bounty received.' : 'Claim your learning bounty.', 'Your wallet & funding.'][stage]}</h2>}
      </header>}
      {stage === 5 && setupReady && <button type="button" className="bs-text-button" disabled={!!busy} onClick={() => setReviewSetup(false)}>Continue to workshop →</button>}
      {stage !== 1 && stage !== 5 && <StrikeWorkshopGuide key={`${stage}-${r.trade?.status || ''}`} initialStep={stage <= 1 ? 0 : stage === 2 ? (r.trade?.status === 'sent' ? 3 : r.trade?.status === 'draft' ? 2 : 1) : stage === 3 ? 4 : 5}/>}
      {embedded && (r.deposit?.status === 'verified' || r.lessonAt) && <p className="bs-workshop-saved">{completed ? '✓ Mission verified · progress saved' : r.lessonAt ? '✓ Order readiness saved' : '✓ Strike deposit verified'}</p>}
      {stage !== 2 && connectionPanel}
      {r.accountId && (stage === 5 || !embedded && !setupReady) && <StrikeWalletSetup data={data} busy={busy} connected={!!setupSession()} walletControls={walletChoice} funding={funding} act={act} deposit={deposit} signDeposit={signDeposit} reconnect={() => connect('practice')} approval={approvalFor('setup')} checkState={setupCheck}/>}
      <article className="sm-card" hidden={embedded && stage !== 0}>
        {!embedded && <><div className="sm-step-label">01 / UNDERSTAND</div><h2>A price limit is a boundary.</h2></>}
        <details open={!embedded}><summary>Review the essentials</summary><div className="sm-lessons">
          <div><span>01</span><h3>Choose your price</h3><p>A buy limit sets the most you will pay. Post-only prevents immediate taker execution, but the resting order can still fill later. Neither guarantees a profit.</p></div>
          <div><span>02</span><h3>Watch what happened</h3><p>An accepted request may still be pending or rejected. Check the actual order status and filled quantity. A resting order can fill while you inspect it.</p></div>
          <div><span>03</span><h3>Know your exit</h3><p>Canceling stops the unfilled remainder. It does not reverse a fill or close an existing position. This mission requires an entirely unfilled order.</p></div>
        </div></details>
        {r.lessonAt ? <div className="sm-check-result"><p className="sm-success" role="status">✓ Order-readiness check passed · saved to your account</p><button type="button" className="sm-secondary" onClick={() => { connectRef.current?.scrollIntoView({ block: 'start' }); connectRef.current?.focus({ preventScroll: true }); }}>Continue to your testnet workspace →</button></div> : <>
          <form className="sm-knowledge-form" noValidate onSubmit={checkUnderstanding}>
            {data.questions.map(q => <fieldset key={q.id} disabled={!!busy}><legend>{q.prompt}</legend>{q.choices.map((choice, index) => <label className={answers[q.id] === index ? 'sm-selected' : ''} key={choice}><input type="radio" name={`strike-mission-${q.id}`} checked={answers[q.id] === index} onChange={() => { setAnswers(a => ({ ...a, [q.id]: index })); setLessonFeedback(''); }}/><span>{choice}</span></label>)}</fieldset>)}
            <div className="sm-check-actions"><p className="sm-small">{data.questions.filter(q => Number.isInteger(answers[q.id])).length} of {data.questions.length} answered{!data.authenticated && ' · sign in to save your result'}</p><button type="submit" className="sm-primary" disabled={!!busy}>{busy === 'Checking your answers…' ? 'Checking your answers…' : 'Check readiness & continue'}</button></div>
            {lessonFeedback && <p ref={feedbackRef} tabIndex={-1} className="sm-check-feedback" role="alert">{lessonFeedback}</p>}
          </form>
          {!data.authenticated && embedded && <div className="sm-knowledge-access"><h3>Save your understanding.</h3><p>Use your existing DRMZ wallet or email sign-in.</p>{signIn || <a className="sm-primary" href="/learn/blockscholar" target="_top">Sign in in Learn →</a>}</div>}
        </>}
        <a className="sm-source" href="https://docs.strikefinance.org/api/trade/orders" target="_blank" rel="noreferrer">Source: Strike’s order documentation ↗</a>
      </article>
      <section ref={connectRef} tabIndex={-1} className="sm-card sm-connect-section" hidden={embedded && stage !== 1}>
        {!embedded && <><div className="sm-step-label">02 / CONNECT</div><h2>Your testnet workspace.</h2></>}
        <details className="sm-wallet-guide"><summary>New to Cardano wallets?</summary><ol><li>Create a wallet in a Cardano wallet app such as VESPR or Lace. Keep its recovery phrase private; DRMZ never asks for it.</li><li>Choose <strong>Preprod</strong> in the wallet’s network settings. Mainnet ADA is not used here.</li><li>On a phone, open this Blockscholar page inside the wallet’s browser. Sign in to the same DRMZ account to recover your progress.</li></ol><button type="button" className="sm-secondary" onClick={() => run('Copying this page…', async () => { await navigator.clipboard.writeText(window.location.href); return {...data, notice:'Page link copied. Open it in your wallet browser.'}; })}>Copy this page link</button>{data.notice && <p role="status">{data.notice}</p>}</details>
        <p>Connect your Preprod wallet, then approve the signature to open your Strike practice account.</p>
        {!data.builderConfigured && <div className="sm-notice"><strong>This workshop is temporarily unavailable.</strong><p>Your progress is saved. Please return later.</p></div>}
        {r.accountId && <p className="sm-success">✓ Wallet connected</p>}
        {data.builderConfigured && !tradingSession() && <>{walletChoice}<button className="sm-primary" disabled={!!busy || !data.authenticated || tradingSession()?.publicKey === r.apiPublicKey && !!r.apiPublicKey} onClick={() => connect('builder')}>{tradingSession()?.publicKey === r.apiPublicKey && r.apiPublicKey ? 'Strike connected in this tab ✓' : r.accountId ? 'Reconnect Strike testnet' : 'Connect Strike testnet'}</button>{approvalFor('connect')}<details><summary>Connection permissions</summary><p className="sm-small">This authorizes testnet trading in this tab. Reloading may require another connection signature. No mainnet trades or builder fees.</p></details></>}
        {!r.accountId && <details><summary>Already have a Strike testnet account?</summary>{walletChoice}<button className="sm-secondary" disabled={!!busy || !r.lessonAt} onClick={() => connect('strike')}>Verify wallet for an external order</button>{approvalFor('external')}<p>Use this route if you place and cancel the order in Strike’s own testnet interface.</p></details>}
      </section>
      <section className="sm-card sm-order-workspace" hidden={embedded && stage !== 2}>
        {!embedded && <><div className="sm-step-label">03 / INSPECT</div><h2>Observe a real order.</h2></>}
        {r.accountId && !completed && <div className="sm-balance-strip">
          <span>Practice balance</span>
          <strong>{fundingChecked ? `${Number(funding.availableBalance).toLocaleString(undefined, { maximumFractionDigits: 2 })} test USD` : 'Not checked yet'}</strong>
          <button type="button" className="bs-text-button" disabled={!!busy} onClick={() => act({ type: 'account-check' }, 'Checking your Strike test balance…')}>Check balance</button>
        </div>}
        {fundingChecked && !funding.funded && <p className="sm-notice">Add test trading credits before placing an order. Your test-ADA bounty is separate.</p>}
        {data.builderConfigured && !completed && <div className="sm-trade"><p>Review a small ETH-USD buy limit, then place it on Strike testnet. Post-only keeps it from filling immediately.</p>{r.trade && <div className="sm-order-review"><p className="sm-step-label">ETH-USD · BUY LIMIT · POST-ONLY</p><dl><div><dt>Size</dt><dd>{r.trade.size} ETH</dd></div><div><dt>Limit price</dt><dd>{r.trade.price} test USD</dd></div><div><dt>Total exposure</dt><dd>≈ {(Number(r.trade.size) * Number(r.trade.price)).toFixed(2)} test USD</dd></div></dl><p className="sm-small">{r.trade.status === 'draft' ? 'Prepared · not submitted' : r.trade.status === 'rejected' ? 'Rejected or expired · prepare a fresh order' : 'Request sent · check actual order status'}</p></div>}
          {connectionPanel}
          {(!r.trade || r.trade.status === 'rejected') && <button className="sm-primary" disabled={!!busy || !r.apiPublicKey} onClick={() => act({ type: 'order-prepare' }, 'Reading current testnet market rules…')}>Prepare practice order</button>}
          {r.trade?.status === 'draft' && <button className="sm-primary" disabled={!!busy || tradingSession()?.publicKey !== r.apiPublicKey} onClick={() => trade('place')}>Place reviewed testnet order</button>}
          {r.trade?.status === 'sent' && <button className="sm-secondary" disabled={!!busy} onClick={() => act({ type: 'order-check' }, 'Checking the actual order state…')}>Check order & save checkpoint</button>}
          {data.notice && <p role="status">{data.notice}</p>}
          <p className="sm-small">Test funds only. Save the open-order checkpoint before canceling.</p>
        </div>}

        {r.order && <div className="sm-evidence"><strong>Open order observed ✓</strong><span>#{r.order.id} · {r.order.side} {r.order.size} ETH at {r.order.price} test USD</span></div>}
        {!completed && <details open={!data.builderConfigured}><summary>Used Strike’s app? Verify your order</summary>{data.testnetApp && <a href={data.testnetApp} target="_blank" rel="noreferrer">Open Strike testnet ↗</a>}<ol className="sm-instructions"><li>On Strike <strong>testnet</strong>, choose ETH-USD and Limit. Keep total notional at or below 100 test USD.</li><li>Choose a resting price within Strike’s allowed price band, and enable post-only if available. It can still fill later; this exercise requires zero fills.</li><li>While the order is <strong>open</strong>, copy its order ID below. Save this checkpoint before canceling.</li></ol><form onSubmit={e => { e.preventDefault(); act({ type: 'observe', orderId: orderId.trim() }, 'Checking the open order with Strike…'); }}><label className="sm-field">Strike order ID<input inputMode="numeric" pattern="[1-9][0-9]*" maxLength={19} value={orderId} onChange={e => setOrderId(e.target.value)} placeholder="Order ID from Strike testnet" required disabled={!!busy || !r.accountId}/></label><button className="sm-primary" disabled={!!busy || !r.accountId || !orderId.trim()}>{r.order ? 'Check a replacement order' : 'Save open-order checkpoint'}</button></form></details>}
        {embedded && replaceOrder && <button type="button" className="bs-text-button" onClick={() => setReplaceOrder(false)}>Back to cancellation</button>}
      </section>
      <section className="sm-card" hidden={embedded && stage !== 3}>
        {!embedded && <><div className="sm-step-label">04 / VERIFY</div><h2>{completed ? 'Mission accomplished.' : 'Cancel. Then confirm.'}</h2></>}
        {completed ? <><p className="sm-success">✓ Strike reported your saved order canceled with zero fills.</p><p>Verified {new Date(r.completedAt).toLocaleString()}. Your progress is saved.</p><details><summary>Completion receipt</summary><code className="sm-hash">{r.receipt}</code><p>Verified against Strike’s testnet order history.</p></details></> : <><p>Cancel the same order below (or in Strike’s testnet interface), then verify its final state.</p><div className="sm-action-row">{r.trade?.clientId && r.order?.clientId === r.trade.clientId && <button className="sm-secondary" disabled={!!busy || tradingSession()?.publicKey !== r.apiPublicKey} onClick={() => trade('cancel')}>Cancel this testnet order</button>}<button className="sm-primary" disabled={!!busy || !r.order} onClick={() => act({ type: 'verify' }, 'Verifying cancellation with Strike…')}>Verify cancellation</button></div><p className="sm-small">If any quantity filled, resolve that test position on Strike and use a new unfilled order for this exercise.</p>{embedded && <button type="button" className="bs-text-button" disabled={!!busy} onClick={() => setReplaceOrder(true)}>Inspect a replacement order</button>}</>}
      </section>
      <section className="sm-card sm-reward" hidden={embedded && stage !== 4}>
        {!embedded && <><div className="sm-step-label">05 / CLAIM</div><h2>{paid ? 'Bounty received.' : 'A receipt for putting it into practice.'}</h2></>}
        <div className="sm-reward-number">2 <span>test ADA</span></div><p>Test ADA · one reward per eligible learner, while funding is available.</p>
        {paid ? <p className="sm-success">✓ Payment confirmed on Cardano Preprod</p> : <>
          {r.rewardAddress ? <p>Reward wallet: <code>{short(r.rewardAddress)}</code></p> : <>{walletChoice}<button className="sm-secondary" disabled={!!busy || !completed} onClick={() => connect('reward')}>Set Preprod reward wallet</button>{approvalFor('reward')}</>}
          <button className="sm-primary" disabled={!!busy || !completed || !r.rewardAddress || !data.reward.configured} onClick={() => act({ type: r.claim?.txHash ? 'receipt' : 'claim' }, r.claim?.txHash ? 'Checking the payment receipt…' : 'Preparing your test-ADA bounty…')}>{r.claim?.txHash ? 'Check payment' : 'Claim 2 test ADA'}</button>
          {r.claim?.txHash && <p role="status">Payment submitted. Checking for two Preprod blocks while this page is open. Your receipt is saved if you leave.</p>}
          {!data.reward.configured && <p className="sm-notice">The bounty campaign is awaiting sponsor setup. You can save a lesson pass now; payout is not available yet.</p>}
        </>}
        {r.claim?.txHash && <a className="sm-secondary" href={`https://preprod.cardanoscan.io/transaction/${r.claim.txHash}`} target="_blank" rel="noreferrer">View bounty transaction ↗</a>}
        <details><summary>How verification and rewards work</summary><p>Complete and verify an unfilled order and its cancellation to claim your reward on Cardano Preprod.</p><p>One reward per linked account and wallet. Test ADA has no monetary value.</p></details>
      </section>
      {data.authenticated && (r.accountId || data.previousAttempts?.length > 0) && <details className="sm-account-settings"><summary>Practice wallet & saved attempts</summary>{r.accountId && stage !== 5 && <button type="button" className="sm-secondary" disabled={!!busy} onClick={() => setReviewSetup(true)}>Review wallet & funding</button>}<p>Your DRMZ sign-in and lessons stay saved when you change practice wallets.</p>{r.wallet && <p>Current practice wallet: <code>{short(r.wallet)}</code></p>}{r.accountId && <button type="button" className="sm-secondary" disabled={!!busy} onClick={() => setShowRestart(true)}>Use a different practice wallet</button>}{showRestart && <div className="sm-setup-step"><h3>Start a fresh testnet attempt?</h3><p>Your old deposit receipts and practice account will be saved below. Funds stay in the original wallet and Strike account; they do not move to the new one. Your lessons stay complete.</p><div className="sm-action-row"><button type="button" className="sm-primary" disabled={!!busy} onClick={() => switchAttempt()}>Save old practice & start fresh</button><button type="button" className="sm-secondary" disabled={!!busy} onClick={() => setShowRestart(false)}>Keep current practice</button></div></div>}{data.previousAttempts?.map(attempt => <div className="sm-setup-step" key={attempt.id}><p>Saved practice · <code>{short(attempt.wallet)}</code>{attempt.creditedUsd ? ` · ${Number(attempt.creditedUsd).toFixed(2)} test USD credited` : ''}</p><div className="sm-action-row"><button type="button" className="sm-secondary" disabled={!!busy} onClick={() => switchAttempt(attempt.id)}>Restore this practice</button>{attempt.depositTx && <a href={`https://preprod.cardanoscan.io/transaction/${attempt.depositTx}`} target="_blank" rel="noreferrer">Deposit receipt ↗</a>}</div></div>)}</details>}
      </div>
      </>}
    </>}
    {!embedded && <footer className="sm-footer"><a href="/learn/quests/strike-practice" target={compact ? '_top' : undefined}>Review the Strike mini-course</a><a href="/spaces?place=stadium&area=strike" target="_top">Visit the Stadium</a></footer>}
  </section>;
}
