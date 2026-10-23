import React from 'react';

export function StrikeWalletSetup({data, busy, connected, walletControls, funding, act, deposit, signDeposit, reconnect}) {
  const r = data.record || {}, d = r.deposit, grant = r.practiceGrant;
  const practice = r.practiceConnection || r;
  const ready = !!practice.accountId && practice.wallet?.startsWith('addr_test1');
  const verified = d?.status === 'verified';
  const signed = ['submitted', 'registered', 'verified'].includes(d?.status);
  const available = funding?.accountId === r.accountId && funding.funded;
  return <section className="sm-card sm-setup" aria-label="Wallet funding and deposit">
    <div className="sm-step-label">PRACTICE WALLET / PREPROD</div>
    <h2>{!ready ? 'Connect your practice wallet.' : verified ? 'Your practice account is ready.' : signed ? 'Your deposit is on its way.' : available ? 'Your Strike account is funded.' : 'Fund your practice wallet.'}</h2>
    <p>{available && !signed ? 'Use your existing Strike test balance to continue. No new deposit is needed.' : 'New practice grants provide 104 test ADA: 100 for your deposit, 2 for Strike’s batcher fee, and 2 for network fees. These are test funds with no monetary value.'}</p>
    <ol className="sm-setup-progress" aria-label="Account setup progress">
      <li className={ready ? "sm-done" : ""}>{ready ? "✓" : "1"} Wallet</li>
      <li className={grant?.status === 'confirmed' ? 'sm-done' : ''}>{grant?.status === 'confirmed' ? '✓' : '2'} Test ADA</li>
      <li className={verified ? 'sm-done' : ''}>{verified ? '✓' : '3'} Strike credit</li>
    </ol>
    <div className="sm-setup-step sm-setup-connector">
      <h3>Cardano wallet · Preprod</h3>
      {!ready && <p>Select your practice wallet, switch it to <strong>Preprod</strong>, then approve the connection. Your DRMZ sign-in and saved lessons stay the same.</p>}
      {ready && <p className="sm-small">Verified address: <code>{practice.wallet.slice(0,16)}…{practice.wallet.slice(-8)}</code></p>}
      {walletControls}
      <button type="button" className="sm-primary" disabled={!!busy || connected && ready} onClick={reconnect}>{connected && ready ? 'Preprod wallet connected ✓' : ready ? 'Reconnect Preprod wallet' : 'Connect Preprod wallet'}</button>
      <details><summary>Connecting on a phone</summary><p>Choose Preprod in your Cardano wallet's settings and open this Blockscholar page in its browser. Sign into your existing DRMZ account, then connect the wallet here. We never ask for your recovery phrase.</p></details>
    </div>
    {ready && available && !signed && <div className="sm-setup-step"><p className="sm-success">✓ {Number(funding.availableBalance).toLocaleString(undefined,{maximumFractionDigits:2})} test USD available on Strike.</p><button type="button" className="sm-primary" disabled={!!busy} onClick={() => act({type:'practice-existing'}, 'Continuing with your funded account…')}>Use existing balance & continue</button><p className="sm-small">Your balance is verified. This does not claim a new deposit or repeat your starter grant.</p></div>}
    {ready && (verified ? <p className="sm-success">✓ Strike credited {d.creditedUsd?.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')} test USD. Deposit verification saved.</p> : <>
      {!signed && !available && <div className="sm-setup-step">
        <h3>{grant?.status === 'confirmed' ? 'Test ADA received' : '1. Fund your practice wallet'}</h3>
        {grant?.status === 'confirmed' ? <p className="sm-success">✓ {(grant.grantAmount ?? 102_000_000) / 1e6} test ADA delivered to your linked wallet.</p> : <>
          <p>{grant ? 'Your grant receipt is saved. Waiting for Preprod confirmation.' : 'One sponsored grant per linked account and wallet. You can also use test ADA already in this wallet.'}</p>
          {data.previousGrant && !grant ? <p>This wallet already received its starter grant. Use its existing test ADA or the existing Strike balance below. You can restore the earlier practice to see its receipt.</p> : <button className="sm-secondary" disabled={!!busy || !grant && !data.practiceSponsor?.configured} onClick={() => act({type: grant ? 'practice-check' : 'practice-fund'}, grant ? 'Checking your practice grant…' : 'Sending sponsored test ADA…')}>{grant ? 'Check test funding' : 'Get sponsored test ADA'}</button>}
          {!data.practiceSponsor?.configured && !grant && <p className="sm-small">The practice sponsor is being prepared. Existing Preprod test ADA works too.</p>}
        </>}
      </div>}
      {(!available || signed) && <div className="sm-setup-step">
        <h3>{signed ? '2. Confirming your Strike credit' : '2. Review your Strike deposit'}</h3>
        <p>{signed ? 'This deposit funds your Strike test account. It does not place a trading order.' : 'Test ADA in your wallet and trading credits on Strike are separate balances. Review the conversion, then approve the deposit in your wallet.'}</p>
        {signed && <div role="status">
          <p className={d.chainConfirmedAt ? 'sm-success' : 'sm-small'}>{d.chainConfirmedAt ? '✓ Wallet payment confirmed on Cardano Preprod.' : 'Checking your saved wallet payment on Cardano Preprod…'}</p>
          <p className="sm-small">{['failed', 'cancelled'].includes(d.settlementStatus) ? 'Strike reported a settlement problem. Your payment receipt is saved; contact DRMZ before making another deposit.' : d.settlementStatus === 'pending_settlement' ? 'Strike received your deposit and is finishing settlement. We’ll unlock the practice account when its final credit is verified. No further signature or deposit is needed.' : d.status === 'registered' ? 'Waiting for Strike’s matching credit receipt. No further deposit is needed.' : 'Your transaction is saved. Resume the Strike credit request below if it was interrupted.'} You can leave and return to this saved step.</p>
        </div>}
        {d && <dl className="sm-deposit-review">
          <div><dt>Deposit</dt><dd>100 Preprod test ADA</dd></div>
          <div><dt>Quoted trading credit</dt><dd>{d.usdValue} test USD</dd></div>
          {d.batcherFee != null && <div><dt>Strike batcher fee</dt><dd>{(d.batcherFee / 1e6).toFixed(2)} test ADA</dd></div>}
          {d.fee != null && <div><dt>Network fee</dt><dd>{(d.fee / 1e6).toFixed(6)} test ADA</dd></div>}
          {d.fee != null && <div><dt>Total wallet spend</dt><dd>{((Number(d.paymentAmount || d.amount) + d.fee) / 1e6).toFixed(6)} test ADA</dd></div>}
          {!signed && <div><dt>Quote expires</dt><dd>{new Date(d.expires).toLocaleTimeString()}</dd></div>}
          <div><dt>{d.paymentAddress ? "Transaction destination" : "Quoted Strike vault"}</dt><dd><code>{d.paymentAddress || d.address}</code></dd></div>
        </dl>}
        {d && <p className="sm-small">Final trading credit may differ from the quote because Strike converts ADA at execution prices. Completion uses the settled receipt.</p>}
        {d?.batcherFee > 0 && <p className="sm-small">Strike’s official testnet API selected this batching address. The total includes its 2-test-ADA fee. DRMZ checks the transaction details; Strike controls the deposit route.</p>}
        {!signed && <div className="sm-action-row">
          <button className={d ? 'sm-secondary' : 'sm-primary'} disabled={!!busy || !connected} onClick={() => deposit('quote')}>{d ? 'Refresh quote' : 'Get deposit quote'}</button>
          {d?.status === 'quoted' && <button className="sm-primary" disabled={!!busy || !connected} onClick={() => deposit('build')}>Review deposit transaction</button>}
          {d?.status === 'built' && <button className="sm-primary" disabled={!!busy} onClick={signDeposit}>Sign · {((Number(d.paymentAmount || d.amount) + (d.fee || 0)) / 1e6).toFixed(6)} test ADA</button>}
        </div>}
        {signed && <div className="sm-action-row">
          {d.status === 'submitted' && <button className="sm-primary" disabled={!!busy || !connected} onClick={() => deposit('confirm')}>Resume Strike credit request</button>}
          <button className="sm-secondary" disabled={!!busy} onClick={() => act({type:'deposit-check'}, 'Checking Preprod and Strike receipts…')}>Check deposit</button>
        </div>}
      </div>}
      {!signed && !available && <details><summary>Already funded your Strike test account?</summary>
        <p>Use an existing test balance without repeating this deposit. This does not award a verified deposit milestone.</p>
        <div className="sm-action-row"><button className="sm-secondary" disabled={!!busy} onClick={() => act({type:'account-check'}, 'Checking Strike test balance…')}>Check existing balance</button>{available && <button className="sm-primary" disabled={!!busy} onClick={() => act({type:'practice-existing'}, 'Saving your existing-balance choice…')}>Use my existing test balance</button>}</div>
      </details>}
    </>)}
    {(grant?.txHash || d?.signedTx || signed) && <details className="sm-setup-receipts"><summary>Saved receipts</summary><div className="sm-action-row">
      {grant?.txHash && <a href={`https://preprod.cardanoscan.io/transaction/${grant.txHash}`} target="_blank" rel="noreferrer">Practice grant ↗</a>}
      {signed && d?.txHash && <a href={`https://preprod.cardanoscan.io/transaction/${d.txHash}`} target="_blank" rel="noreferrer">Strike deposit ↗</a>}
    </div></details>}
  </section>;
}
