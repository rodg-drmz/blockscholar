import React from 'react';

export function StrikeWalletSetup({data, busy, connected, walletControls, funding, act, deposit, signDeposit, reconnect, approval = null, checkState = {}}) {
  const r = data.record || {}, d = r.deposit, grant = r.practiceGrant;
  const practice = r.practiceConnection || r;
  const ready = !!practice.accountId && practice.wallet?.startsWith('addr_test1');
  const verified = d?.status === 'verified';
  const signed = ['submitted', 'registered', 'verified'].includes(d?.status);
  const available = !!practice.accountId && !!funding && funding.accountId === practice.accountId && funding.funded;
  const paymentConfirmed = !!d?.chainConfirmedAt;
  const failed = ['failed', 'cancelled'].includes(d?.settlementStatus);
  const needsConnection = !connected && !verified && (!signed || d?.status === 'submitted');
  const heading = !ready ? 'Connect your practice wallet.' : verified ? 'Ready to practice.' : failed ? 'Deposit needs attention.' : signed ? paymentConfirmed ? 'Waiting for Strike credit.' : 'Confirming your deposit.' : available ? 'Your trading balance is ready.' : 'Fund your practice wallet.';
  const details = d && <dl className="sm-deposit-review">
    <div><dt>Deposit</dt><dd>100 Preprod test ADA</dd></div>
    <div><dt>Estimated trading credit</dt><dd>{d.usdValue} test USD</dd></div>
    {d.batcherFee != null && <div><dt>Strike batcher fee</dt><dd>{(d.batcherFee / 1e6).toFixed(2)} test ADA</dd></div>}
    {d.fee != null && <div><dt>Network fee</dt><dd>{(d.fee / 1e6).toFixed(6)} test ADA</dd></div>}
    {d.fee != null && <div><dt>Total wallet spend</dt><dd>{((Number(d.paymentAmount || d.amount) + d.fee) / 1e6).toFixed(6)} test ADA</dd></div>}
    {!signed && <div><dt>Quote expires</dt><dd>{new Date(d.expires).toLocaleTimeString()}</dd></div>}
    <div><dt>Destination</dt><dd><code>{d.paymentAddress || d.address}</code></dd></div>
  </dl>;
  return <section className="sm-card sm-setup" aria-label="Wallet funding and deposit">
    <h2>{heading}</h2>
    <ol className="sm-setup-progress" aria-label="Account setup progress">
      <li className={ready ? 'sm-done' : ''}>{ready ? '✓' : '1'} Wallet</li>
      <li className={grant?.status === 'confirmed' || signed || available ? 'sm-done' : ''}>{grant?.status === 'confirmed' || signed || available ? '✓' : '2'} Test funds</li>
      <li className={verified || available && !signed ? 'sm-done' : ''}>{verified || available && !signed ? '✓' : '3'} Strike credit</li>
    </ol>
    {needsConnection && <div className="sm-setup-step sm-setup-connector">
      <p>{ready ? 'Reconnect to authorize the next step.' : 'Choose a Cardano wallet on Preprod.'}</p>
      {walletControls}
      <button type="button" className="sm-primary" disabled={!!busy} onClick={reconnect}>{ready ? 'Reconnect wallet' : 'Connect Preprod wallet'}</button>
      {approval}
    </div>}
    {ready && available && !signed && <div className="sm-setup-step">
      <p className="sm-success">{Number(funding.availableBalance).toLocaleString(undefined,{maximumFractionDigits:2})} test USD available</p>
      <button type="button" className="sm-primary" disabled={!!busy} onClick={() => act({type:'practice-existing'}, 'Opening your workshop…')}>Continue to practice</button>
    </div>}
    {ready && (verified ? <p className="sm-success">✓ {d.creditedUsd} test USD credited</p> : signed ? <div className="sm-setup-step sm-deposit-status" aria-live="polite">
      <p className={paymentConfirmed ? 'sm-success' : ''}>{paymentConfirmed ? '✓ Deposit confirmed on Cardano' : 'Waiting for Cardano confirmation…'}</p>
      <p>{failed ? 'Strike reported a settlement issue. Keep your receipt and contact support before making another deposit.' : paymentConfirmed ? 'Strike is processing your trading credit. The workshop opens when it is verified.' : 'Your signed deposit is saved. No further payment is needed.'}</p>
      <p className="sm-small">{checkState.checking ? 'Checking your receipt…' : checkState.checkedAt ? `Last checked ${new Date(checkState.checkedAt).toLocaleTimeString()}` : 'Checking automatically while this page is open.'}</p>
      {checkState.warning && <p className="sm-check-feedback" role="status">{checkState.warning}</p>}
      <div className="sm-action-row">
        {d.status === 'submitted' && connected && <button className="sm-secondary" disabled={!!busy || checkState.checking} onClick={() => deposit('confirm')}>Resume deposit</button>}
        <button className="sm-primary" disabled={!!busy || checkState.checking} onClick={() => act({type:'deposit-check'}, 'Checking your trading credit…')}>{checkState.checking ? 'Checking…' : 'Check credit'}</button>
      </div>
    </div> : !available && <>
      {grant?.status !== 'confirmed' && <div className="sm-setup-step">
        <p>{grant ? 'Your test funds are on their way.' : 'Get 104 test ADA to cover the practice deposit and fees.'}</p>
        {data.previousGrant && !grant ? <p className="sm-small">This wallet already received practice funds. Use its remaining test ADA or check your Strike balance below.</p> : <button className="sm-primary" disabled={!!busy || checkState.checking || !grant && !data.practiceSponsor?.configured} onClick={() => act({type: grant ? 'practice-check' : 'practice-fund'}, grant ? 'Checking practice funds…' : 'Sending practice funds…')}>{grant ? 'Check test funding' : 'Get sponsored test ADA'}</button>}
        {checkState.warning && <p role="status" className="sm-small">{checkState.warning}</p>}
        {!data.practiceSponsor?.configured && !grant && <p className="sm-small">Sponsored funding is unavailable. You can use your own Preprod test ADA.</p>}
      </div>}
      {grant?.status === 'confirmed' && <p className="sm-success">✓ {(grant.grantAmount ?? 104_000_000) / 1e6} test ADA received</p>}
      <div className="sm-setup-step">
        <h3>Deposit to Strike</h3>
        <p>Review the test-ADA cost, then approve the deposit in your wallet.</p>
        {details}
        {d && <p className="sm-small">Trading credit uses Strike’s price at settlement and may differ from this estimate.</p>}
        <div className="sm-action-row">
          {d?.status !== 'built' && <button className={d ? 'sm-secondary' : 'sm-primary'} disabled={!!busy || !connected} onClick={() => deposit('quote')}>{d ? 'Refresh quote' : 'Get deposit quote'}</button>}
          {d?.status === 'quoted' && <button className="sm-primary" disabled={!!busy || !connected} onClick={() => deposit('build')}>Review deposit transaction</button>}
          {d?.status === 'built' && <><button className="sm-primary" disabled={!!busy || !connected} onClick={signDeposit}>Sign · {((Number(d.paymentAmount || d.amount) + (d.fee || 0)) / 1e6).toFixed(6)} test ADA</button><button className="bs-text-button" disabled={!!busy || !connected} onClick={() => deposit('quote')}>Refresh quote</button></>}
        </div>
      </div>
      <details><summary>Already have a Strike balance?</summary><button className="sm-secondary" disabled={!!busy} onClick={() => act({type:'account-check'}, 'Checking your balance…')}>Check existing balance</button></details>
    </>)}
    <details className="sm-setup-receipts"><summary>Wallet & receipts</summary>
      {ready && <p className="sm-small">Preprod · <code>{practice.wallet.slice(0,16)}…{practice.wallet.slice(-8)}</code></p>}
      {signed && details}
      <div className="sm-action-row">
        {grant?.txHash && <a href={`https://preprod.cardanoscan.io/transaction/${grant.txHash}`} target="_blank" rel="noreferrer">Practice funds ↗</a>}
        {signed && d?.txHash && <a href={`https://preprod.cardanoscan.io/transaction/${d.txHash}`} target="_blank" rel="noreferrer">Deposit receipt ↗</a>}
      </div>
    </details>
    <p className="sm-small">Test funds only · no monetary value</p>
  </section>;
}
