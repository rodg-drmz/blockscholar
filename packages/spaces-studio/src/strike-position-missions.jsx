import React,{useEffect,useRef,useState} from 'react';

export function StrikePositionMissions({data,busy,act,submit,connected,connection,feedback = null}) {
  const [direction,setDirection]=useState(()=>data.record?.positions?.short?.entry?.sentAt && !data.record?.positions?.short?.completedAt || data.record?.positions?.long?.completedAt && !data.record?.positions?.short?.completedAt ? 'short':'long'),[answers,setAnswers]=useState({});
  const r=data.record,p=r?.positions?.[direction],scenario=data.positionScenarios?.[direction];
  const entry=p?.entry,exit=p?.exits?.at(-1),complete=!!p?.completedAt;
  const noLiquidity=p?.closeBook?.size==='0';
  const waiting=entry?.status==='sent' || p?.exits?.some(e=>e.status==='sent');
  const entryPhase=!entry || entry.status==='draft' || entry.status==='terminal' && Number(entry.filled || 0)===0;
  const entryPaused=entryPhase && p?.entryLiquidity && p.entryLiquidity.status!=='ready';
  const paused=!complete && !waiting && (entryPaused || p?.open && noLiquidity);
  const unavailable=entryPaused && p.entryLiquidity.status==='unavailable';
  const check=()=>act({type:'position-check',direction},'Checking fills and position on Strike…');
  const latest=useRef({check,busy});latest.current={check,busy};
  useEffect(()=>{
    if(!waiting) return;
    const start=Date.now(),timer=setInterval(()=>{
      if(Date.now()-start>180_000) {clearInterval(timer);return;}
      if(!latest.current.busy && document.visibilityState==='visible') latest.current.check();
    },7000);
    return ()=>clearInterval(timer);
  },[waiting,direction]);
  const prepare=operation=>act({type:'position-prepare',direction,operation},'Preparing your testnet review…');
  const review=(request,operation)=><div className="sm-position-review">
    <h3>{operation==='entry'?`Open a small ${direction}`:`Close your ${direction}`}</h3>
    <dl className="bs-ledger"><div><dt>Order</dt><dd>{operation==='entry'?(direction==='long'?'Buy':'Sell'):(direction==='long'?'Sell':'Buy')} {request.size} ETH · market</dd></div>
      {operation==='entry' && <><div><dt>Reference ETH price</dt><dd>{(Number(request.estimate)/Number(request.size)).toFixed(2)} test USD</dd></div><div><dt>Estimated exposure</dt><dd>{Number(request.estimate).toFixed(2)} test USD</dd></div></>}
      <div><dt>Maximum slippage</dt><dd>1% · execution may be partial</dd></div><div><dt>DRMZ builder fee</dt><dd>0%</dd></div><div><dt>Close protection</dt><dd>{operation==='exit'?'Reduce-only: cannot reverse your position':'New position'}</dd></div></dl>
    <p className="sm-small">Strike’s trading fees and any funding apply to test credits. Actual execution price can differ from the estimate. This uses your account’s existing margin and leverage settings; DRMZ does not increase them.</p>
    <div className="sm-action-row"><button type="button" className="sm-primary" disabled={!!busy || !connected || paused} onClick={()=>submit(direction,operation,request)}>Confirm {operation==='entry'?`test ${direction}`:'reduce-only close'}</button><button type="button" className="sm-secondary" disabled={!!busy} onClick={()=>prepare(operation)}>Refresh review</button></div>
    <p className="sm-small">Review valid for one minute. Each request is saved before it is sent.</p>
  </div>;
  return <section className="sm-position-missions" aria-label="Long and short missions">
    <div className="sm-position-tabs" role="group" aria-label="Choose a position mission">{['long','short'].map(d=><button key={d} type="button" aria-pressed={direction===d} onClick={()=>setDirection(d)}>{d==='long'?'01 · Long':'02 · Short'}{r?.positions?.[d]?.completedAt?' ✓':''}</button>)}</div>
    {!r?.completedAt?<article className="sm-card"><h2>Start with the order workshop.</h2><p>Finish placing, inspecting and canceling your first order. These missions will then use that same funded wallet and saved account.</p></article>:scenario && <article className="sm-card">
      <span className="sm-step-label">STRIKE TESTNET · {complete?'VERIFIED':paused?'PAUSED':!p?'SCENARIO':!p.open?'OPEN & INSPECT':'CLOSE & VERIFY'}</span>
      <h2>{complete?`${direction==='long'?'Long':'Short'} mission complete.`:scenario.title}</h2>
      <p className="sm-small">Same funded wallet · {r.wallet?.slice(0,16)}…{r.wallet?.slice(-8)} · saved to your DRMZ account</p>
      {!p?<><p>{scenario.story}</p><p className="sm-small">These are hypothetical scenarios. A position can lose test credits through price moves, funding and fees. Cancellation does not close an already filled position.</p>
        <form onSubmit={e=>{e.preventDefault();act({type:'position-scenario',direction,answers:scenario.questions.map((_,i)=>answers[`${direction}-${i}`])},'Checking your scenario…');}}>
          {scenario.questions.map((q,i)=><fieldset key={`${direction}-${i}`} disabled={!!busy}><legend>{q.prompt}</legend>{q.choices.map((choice,j)=><label key={choice} className={answers[`${direction}-${i}`]===j?'sm-selected':''}><input type="radio" required name={`position-${direction}-${i}`} checked={answers[`${direction}-${i}`]===j} onChange={()=>setAnswers(a=>({...a,[`${direction}-${i}`]:j}))}/><span>{choice}</span></label>)}</fieldset>)}
          <button className="sm-primary" disabled={!!busy}>Check scenario & continue</button>
        </form></>:complete?<><p className="sm-success" role="status">✓ Entry fills verified · reduce-only exit verified · no ETH position or open ETH orders remain at verification.</p><p>Your scenario and trading evidence are saved. This mission adds no new bounty; your original 2-test-ADA receipt stays intact.</p><details><summary>View verified evidence</summary><p>Entry order #{entry.orderId} · {entry.filled} ETH filled</p>{p.exits.filter(e=>e.orderId).map(e=><p key={e.clientId}>Close order #{e.orderId} · {e.filled} ETH filled</p>)}<p>Verified {new Date(p.completedAt).toLocaleString()}</p><code className="sm-hash">{p.receipt}</code><p className="sm-small">DRMZ receipt of Strike API evidence. Not a ZK proof or an accredited credential.</p></details>{direction==='long' && !r.positions?.short?.completedAt && <button type="button" className="sm-primary" onClick={()=>setDirection('short')}>Continue to the short scenario →</button>}</>:<>
        <p className="sm-success">✓ Scenario saved</p>
        {paused && <div className="sm-position-paused" role="status">
          <h3>{unavailable?'Paused — liquidity check unavailable':'Paused — waiting for liquidity'}</h3>
          <p>{p.open?`Your ${direction} is still open. Strike’s ETH testnet has no ${direction==='long'?'buyers to sell to':'sellers to buy from'} in the last check. Closing is paused until liquidity returns.`:p.entryLiquidity.reason}</p>
          <p className="sm-small">{p.open?'Your position, wallet and saved progress are intact. Pausing the lesson does not freeze the position’s price or funding.':'No new position was opened. Your wallet and saved progress are intact.'} No orders are retried automatically.</p>
          <p className="sm-small">Last checked {new Date(p.open?p.closeBook.checkedAt:p.entryLiquidity.checkedAt).toLocaleString()}.</p>
        </div>}
        {!connected && !paused && connection}
        {!entry || entry.status==='terminal' && Number(entry.filled)===0 ? <>{!paused && <p>Open a small ETH {direction}, observe the filled position, then close it. Entry exposure is capped at 15 test USD. Finish one mission before starting the other. We check nearby liquidity on both sides before opening; future exit liquidity is not guaranteed.</p>}{entry && !paused && <p className="sm-notice">The last entry had no fills. You can prepare a fresh review.</p>}{!paused && <button type="button" className="sm-primary" disabled={!!busy || !connected} onClick={()=>prepare('entry')}>Review test {direction}</button>}</>:entry.status==='draft'?(paused?null:review(entry,'entry')):<>
          {p.open && <div className="sm-evidence"><strong>{direction==='long'?'Long':'Short'} observed ✓</strong><span>{p.open.size} ETH · entry price {Number(p.open.entryPrice).toFixed(2)} test USD</span><span>Entry #{entry.orderId}</span></div>}
          {exit?.status==='terminal' && <p className="sm-notice" role="status">Close #{exit.orderId || 'request'}: {Number(exit.filled || 0)===0?'nothing filled':`${exit.filled} ETH closed`}. {exit.closeReason==='market_order_exceeded_slippage'?'Strike canceled the unfilled amount at its slippage limit.':`Strike reported ${exit.outcome}.`} Your remaining position is still open.</p>}
          {p.closeBook && !paused && <p className="sm-small">{noLiquidity?`No ${direction==='long'?'buyers':'sellers'} available on Strike’s ETH testnet book. A market close needs someone on the other side. No automatic retries are sent.`:`Best available ${direction==='long'?'bid':'ask'}: ${Number(p.closeBook.bestPrice).toFixed(2)} test USD. Liquidity can change before execution.`} Checked {new Date(p.closeBook.checkedAt).toLocaleTimeString()}.</p>}
          {waiting?<p role="status">Waiting for Strike’s fills and position update. You can leave and return; the request is saved. Checks resume while this page is visible.</p>:paused?null:!p.open?<p>Check Strike to verify the filled position before closing.</p>:exit?.status==='draft'?review(exit,'exit'):<><p>Close the remaining position with the opposite, reduce-only order. A partial close requires another review for the remainder.</p><button type="button" className="sm-primary" disabled={!!busy || !connected || noLiquidity} onClick={()=>prepare('exit')}>Review close</button></>}
        </>}
        <div className="sm-action-row"><button type="button" className="sm-secondary" disabled={!!busy} onClick={check}>{paused?'Check liquidity again':'Check status & save progress'}</button></div>
        <details><summary>If you leave or something changes</summary><p>Return using the same DRMZ sign-in and wallet. Reconnect only to authorize a new trade; status checks need no wallet approval. Do not trade ETH elsewhere while a mission is running. If the position changes outside DRMZ, review it in Strike testnet before continuing.</p><a href="https://testnet.strikefinance.org" target="_blank" rel="noreferrer">Open Strike testnet ↗</a></details>
      </>}
      {feedback}
    </article>}
  </section>;
}
