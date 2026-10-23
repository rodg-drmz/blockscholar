import React, { useCallback, useEffect, useState } from 'react';

const ada = (value, maximumFractionDigits = 6) => (value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits });
export function DreamFund({ active = true }) {
  const [fund, setFund] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [copied, setCopied] = useState(false);
  const load = useCallback(async signal => {
    setLoading(true);
    try {
      const response = await fetch('/api/learn/dream-fund', { cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error);
      setFund(next); setError('');
    } catch (e) { if (e.name !== 'AbortError') setError(e.message || 'The fund could not be refreshed.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); void load(controller.signal);
    const refresh = () => { if (document.visibilityState === 'visible') void load(controller.signal); };
    const timer = setInterval(refresh, 60_000); window.addEventListener('focus', refresh);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [active, load]);
  return <section aria-label="Dream Fund dashboard">
    <div className="bs-section-intro"><span className="sm-step-label">OPPORTUNITY THROUGH LEARNING</span><h2>Dream Fund</h2><p>A fund for scholarships and learning bounties, connecting DeFi skills with work-based learning.</p></div>
    <div className="bs-fund-purpose">
      <p>DRMZ Web3 is the founding sponsor, with funding from the DRMZ stake pool. Our plan is to direct a portion of builder fees earned through our Strike Finance integration into opportunities for learners, alongside support from stake pools, employers and other sponsors.</p>
      <ol className="bs-fund-path"><li><strong>Support the learning</strong><span>Sponsors fund a program and define the skills they want learners to develop.</span></li><li><strong>Practice something real</strong><span>Start with DeFi on Strike; expand to employer-backed projects and work-based learning.</span></li><li><strong>Reward demonstrated skills</strong><span>Use verified work to award learning bounties and support future scholarships.</span></li></ol>
      <p className="sm-small">Today’s pilot pays test-ADA bounties. Revenue-funded scholarships are planned, not active. Award funds will be kept separate from any experimental trading allocation; protocol returns are not guaranteed.</p>
    </div>
    <hr className="bs-program-divider"/>
    <h3>Today’s learning fund</h3>
    <div className="bs-fund-badge"><span className="bs-sponsor-mark"><img className="bs-sponsor-logo" width="36" height="36" src="/images/nft/drmz-ouroboros-snake-only.png" alt=""/></span><div><strong>DRMZ Web3</strong><span>Founding sponsor · Strike Foundations</span></div><span className="bs-tag">Preprod pilot</span></div>
    <p className="sm-small">Preprod test ADA only · no monetary value.</p>
    {error && <p className="sm-error" role="alert">{error}{fund && ' Previously loaded figures may be out of date.'}</p>}
    {!fund && loading && <div className="bs-skeleton" role="status">Reading the fund’s accounting…</div>}
    {fund && !fund.enabled && <div className="sm-card"><h3>The testnet program is not enabled here.</h3><p>Return to the local pilot to view its fund.</p></div>}
    {fund?.enabled && <>
      <div className="bs-stats">
        <div><span>Available wallet</span><strong>{fund.balance ? ada(fund.balance.balanceLovelace, 2) : '—'}</strong><small>{fund.balance ? 'test ADA · rounded' : 'Balance not verified'}</small></div>
        <div><span>Bounties paid</span><strong>{ada(fund.paidLovelace)}</strong><small>test ADA paid · {fund.stats.claimsPaid + (fund.stats.fieldNoteClaimsPaid || 0)} payments</small></div>
        <div><span>Full programs funded</span><strong>{fund.estimatedFundedClaims ?? '—'}</strong><small>5 test ADA each, plus fees</small></div>
      </div>
      {fund.fundingStatus === 'unavailable' && <p className="sm-notice">The network balance is unavailable. Payment records below are saved locally; funding capacity will appear after a successful network check.</p>}
      {fund.fundingStatus === 'not-configured' && <p className="sm-notice">The dedicated learning sponsor has not been configured on this deployment.</p>}
      {fund.fundingStatus === 'needs-funding' && <p className="sm-notice">The fund cannot currently cover another full 5-test-ADA program plus fees and change. Individual pending rewards are checked at claim time.</p>}
      <details className="bs-disclosure"><summary>Funding & campaign details</summary>
        <dl className="bs-ledger">
          {fund.balance && <div><dt>Exact wallet balance</dt><dd>{ada(fund.balance.balanceLovelace)} test ADA</dd></div>}
          <div><dt>Bounty per verified mission</dt><dd>{ada(fund.rewardLovelace)} test ADA</dd></div>
          <div><dt>Field-note bounty</dt><dd>{ada(fund.fieldNoteRewardLovelace)} test ADA</dd></div><div><dt>Total per completed program</dt><dd>{ada(fund.programRewardLovelace)} test ADA</dd></div>
          <div><dt>Campaign limit</dt><dd>{fund.maximumClaims} learners · two rewards each</dd></div>
          <div><dt>New learners remaining under the limit</dt><dd>{fund.remainingClaims}</dd></div>
          <div><dt>Payments pending confirmation</dt><dd>{ada(fund.pendingLovelace)} test ADA</dd></div>
          <div><dt>Verified missions still unpaid</dt><dd>{ada(fund.verifiedUnpaidLovelace)} test ADA</dd></div>
          <div><dt>Fees on confirmed payments</dt><dd>{ada(fund.stats.feesPaidLovelace)} test ADA</dd></div>
        </dl>
        <p className="sm-small">The campaign limit is not a funding promise. Capacity uses spendable ADA-only outputs, excludes saved payout inputs, and allows up to {ada(fund.feeAllowanceLovelace)} test ADA per new payment for fees, with {ada(fund.changeReserveLovelace ?? 1000000)} test ADA reserved for change. A pending payment can temporarily reduce capacity. Funding is checked again at claim time.</p>
        <p className="sm-small">Unpaid totals include pending claims; these figures should not be added together.</p>
      </details>
      <details className="bs-disclosure"><summary>Program outcomes</summary>
        <div className="bs-stats"><div><strong>{fund.stats.enrolled}</strong><span>Program participants</span></div><div><strong>{fund.stats.verifiedMissions}</strong><span>Verified Strike missions</span></div><div><strong>{fund.stats.fieldNotes}</strong><span>Saved field notes</span></div></div>
        <p className="sm-small">Mission and payment totals include earlier runs of the same Strike mission. A saved field note is participant-authored, not an employer assessment or a credential.</p>
      </details>
      {fund.address && <details className="bs-disclosure"><summary>Fund the learning wallet</summary><p>Send Cardano <strong>Preprod test ADA only</strong>. This wallet is separate from DRMZ’s polling sponsors and mainnet funds.</p><code className="bs-address">{fund.address}</code><div className="bs-actions"><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(fund.address); setCopied(true); } catch { setError('Copy is unavailable in this browser. Select and copy the address above.'); } }}>{copied ? 'Address copied' : 'Copy Preprod address'}</button><a className="sm-secondary" href={`https://preprod.cardanoscan.io/address/${fund.address}`} target="_blank" rel="noreferrer">Inspect on Cardanoscan ↗</a></div></details>}
      <article className="sm-card"><h3>Payment receipts.</h3>{fund.stats.payments.length ? <ul className="bs-payments">{fund.stats.payments.map(payment => <li key={payment.txHash}><div><strong>{ada(payment.amountLovelace ?? fund.rewardLovelace)} test ADA</strong><span>{payment.confirmedAt ? new Date(payment.confirmedAt).toLocaleDateString() : 'Confirmed'}</span></div><a href={`https://preprod.cardanoscan.io/transaction/${payment.txHash}`} target="_blank" rel="noreferrer">{payment.txHash.slice(0, 10)}…{payment.txHash.slice(-6)} ↗</a></li>)}</ul> : <p>No bounty payments are confirmed yet. Complete the verified mission to become eligible for a claim.</p>}<p className="sm-small">Cardano payment transactions are public. Names, emails, Strike accounts, and field notes are not published in this dashboard.</p></article>
      <p className="sm-small">{fund.checkedAt ? `Network snapshot: ${new Date(fund.checkedAt).toLocaleString()}.` : 'Awaiting a network snapshot.'} Refreshes each minute while visible.</p>
    </>}
    <button type="button" disabled={loading} onClick={() => load()}>{loading ? 'Refreshing…' : 'Refresh fund'}</button>
  </section>;
}
