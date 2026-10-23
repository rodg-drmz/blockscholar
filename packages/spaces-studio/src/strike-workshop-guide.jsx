import React, { useState } from 'react';

const screens = [
  ['connect', 'Connect Strike testnet', 'Choose your Cardano wallet and approve the connection message. This links a Strike testnet account without replacing your DRMZ login.'],
  ['fund', 'Check funds and prepare', 'Complete Wallet & Funding in this workshop: request sponsored test ADA, review the deposit, and sign with your Preprod wallet. Wait for verified Strike credit. If you already funded Strike, use Check existing balance. The order screen shown here follows account setup.'],
  ['review', 'Review before placing', 'Read the market, side, price, size and total exposure. Only then choose Place reviewed testnet order. The example numbers here are not a suggested order.'],
  ['checkpoint', 'Save the open-order checkpoint', 'Choose Check order & save checkpoint. Wait for DRMZ to verify that the order is open and completely unfilled before canceling it. An accepted request alone is not enough.'],
  ['cancel', 'Cancel, then verify', 'Choose Cancel this testnet order, then Verify cancellation. A cancellation only removes the unfilled remainder. If anything filled, manage that position on Strike and inspect a new order.'],
  ['claim', 'Claim the test bounty', 'Switch the reward wallet to Cardano Preprod. Set Preprod reward wallet verifies ownership; Claim 2 test ADA submits the reward. Keep the saved transaction receipt until payment confirms.'],
];

/** Screenshots of the actual component using isolated example data, never a learner's account. */
export function StrikeWorkshopGuide({ initialStep = 0 }) {
  const [step, setStep] = useState(initialStep);
  const [id, title, description] = screens[step];
  return <details className="sm-workshop-guide">
    <summary>See workshop steps</summary>
    <nav aria-label="Workshop screenshot steps">{screens.map(([key, name], i) => <button key={key} type="button" aria-label={`${i + 1}. ${name}`} aria-pressed={i === step} onClick={() => setStep(i)}>{i + 1}</button>)}</nav>
    <h3>{title}</h3><p>{description}</p>
    <figure><a href={`/images/blockscholar/${id}.png`} target="_blank" rel="noreferrer" aria-label={`Enlarge example: ${title}`}><img src={`/images/blockscholar/${id}.png`} alt={`Example DRMZ workshop screen: ${title}`} width="390" height="1000" loading="lazy"/></a><figcaption>Example screen · sample values, not your account. Trading controls in these screenshots are inactive. Tap the image to enlarge.</figcaption></figure>
  </details>;
}
