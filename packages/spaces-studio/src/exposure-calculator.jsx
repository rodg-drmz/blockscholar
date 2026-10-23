import React, { useState } from 'react';
import { exposureExample } from '../../../lib/blockscholar/program.mjs';

const money = value => Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed = value => `${value < 0 ? '−' : value > 0 ? '+' : ''}`;

export function ExposureCalculator() {
  const [notional, setNotional] = useState('1000'), [margin, setMargin] = useState('100');
  const [move, setMove] = useState('-2'), [side, setSide] = useState('long');
  const change = notional.trim() && move.trim() ? exposureExample(Number(notional), Number(move), side) : null;
  const validMargin = margin.trim() && Number.isFinite(Number(margin)) && Number(margin) > 0 && Number(margin) <= 100_000;
  const marginChange = change !== null && validMargin ? change / Number(margin) * 100 : null;
  const reset = () => { setNotional('1000'); setMargin('100'); setMove('-2'); setSide('long'); };

  return <section className="bs-exposure-practice" aria-label="Practice exposure calculator">
    <h3>Try the numbers.</h3>
    <p className="sm-small">Start with $100 of margin supporting $1,000 of exposure. For a long, a 2% price drop is a loss on the full exposure—not just the margin.</p>
    <div className="bs-calculator bs-exposure-inputs">
      <label>Position exposure (USD)<input type="number" inputMode="decimal" min="0" max="100000" step="any" value={notional} onChange={e => setNotional(e.target.value)}/></label>
      <label>Margin (USD)<input type="number" inputMode="decimal" min="0.01" max="100000" step="any" value={margin} onChange={e => setMargin(e.target.value)}/></label>
      <label>Price move (%)<input type="number" inputMode="text" min="-100" max="100" step="any" value={move} onChange={e => setMove(e.target.value)}/></label>
      <label>Direction<select aria-label="Direction" value={side} onChange={e => setSide(e.target.value)}><option value="long">Long</option><option value="short">Short</option></select></label>
    </div>
    <output className="bs-calculation bs-exposure-result" aria-live="polite" aria-atomic="true">
      {change === null || marginChange === null ? <span className="bs-calculation-help">Enter exposure from $0–$100,000, margin above $0 up to $100,000, and a price move from −100% to 100%.</span> : <>
        <span className="bs-calculation-label">Price-only {change < 0 ? 'loss' : change > 0 ? 'gain' : 'change'}</span>
        <strong>{signed(change)}${money(change)}</strong>
        <span className="bs-calculation-help">${money(Number(notional))} × {Number(move)}%{side === 'short' ? ' × −1 (short)' : ''} = {signed(change)}${money(change)}</span>
        <span className="bs-calculation-help">{signed(marginChange)}{money(marginChange)}% of your ${money(Number(margin))} margin</span>
      </>}
    </output>
    <p className="sm-small">Now double the exposure, then switch Long to Short. Predict the result before changing each input.</p>
    <button className="bs-text-button" type="button" onClick={reset}>Reset lesson example</button>
    <p className="sm-small bs-calculator-note">Practice only. Excludes fees, funding, slippage and liquidation. No orders are placed.</p>
  </section>;
}
