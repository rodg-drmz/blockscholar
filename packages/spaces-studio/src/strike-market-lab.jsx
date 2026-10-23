import React, { useEffect, useState } from 'react';
import { ExposureCalculator } from './exposure-calculator.jsx';

export function StrikeMarketLab({ active }) {
  const [snapshot, setSnapshot] = useState(null), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const response = await fetch('/api/learn/blockscholar/markets', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        setSnapshot(data); setError('');
      } catch (e) { if (e.name !== 'AbortError') { setSnapshot(null); setError(e.message); } }
    };
    void load(); const timer = setInterval(load, 30_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [active, retry]);
  return <article className="sm-card">
    <span className="sm-step-label">STRIKE DESK / READ THE MARKET</span><h2>Real data. Room to practice.</h2><p>Read current Strike testnet prices, then explore how exposure changes a hypothetical outcome.</p>
    {error ? <p className="sm-notice" role="status">{error} <button type="button" onClick={() => setRetry(v => v + 1)}>Retry prices</button></p> : snapshot ? <><div className="bs-stats">{snapshot.markets.map(market => <div key={market.symbol}><span>{market.symbol}</span><strong>${Number(market.mark).toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong><small>Mark price · {market.status}</small>{!market.boundsConsistent && <small>Order limits need review</small>}</div>)}</div><p className="sm-small">Strike testnet snapshot · {new Date(snapshot.checkedAt).toLocaleTimeString()} · refreshes every 30 seconds while open. A mark price is not an execution quote.</p></> : <p role="status">Reading Strike testnet…</p>}
    <p className="sm-small">The calculator below uses your practice inputs, independently of these live prices.</p>
    <ExposureCalculator/>
    <a className="sm-source" href="https://github.com/strike-finance/strike-finance-skills/tree/main/skills/strike-calculations" target="_blank" rel="noreferrer">Strike calculation reference ↗</a>
  </article>;
}
