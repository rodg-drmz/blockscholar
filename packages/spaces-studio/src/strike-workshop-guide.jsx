import React, { useState } from 'react';

const screens = [
  ['connect', 'Connect Strike testnet', 'Sign in with your Cardano wallet, then authorize Strike practice for the same account. Your program progress stays saved.'],
  ['fund', 'Get practice funds', 'Use your Preprod wallet. Request sponsored test ADA, or check an existing Strike balance before depositing again. Practice funding is separate from your learning rewards.'],
  ['deposit', 'Review the deposit', 'Review the 100-test-ADA deposit, Strike batcher fee, network fee, and total wallet spend. Sign only after reviewing. The workshop opens after Strike verifies the trading credit; a Cardano receipt alone is not settled credit.'],
  ['review', 'Review before placing', 'Check the market, side, limit price, size, and total exposure, then choose Place reviewed testnet order. These sample values are not a suggested order.'],
  ['checkpoint', 'Verify the open order', 'Choose Check order & save checkpoint. Strike must report the matching order as open with zero fills. A submitted request alone does not complete this step.'],
  ['cancel', 'Inspect, cancel, and verify', 'After the open-order confirmation, you can inspect the order on Strike using the same wallet. Return to cancel it. Blockscholar checks for a matching zero-fill cancellation; use Verify cancellation if confirmation is still pending.'],
  ['claim', 'Claim the mission bounty', 'Claim 2 test ADA uses your already verified Preprod reward wallet. DRMZ pays the fee; no repeat ownership signature is needed. The receipt updates when payment confirms.'],
  ['field-note', 'Finish your field note', 'Save what you learned and where you could apply it. After the first bounty confirms, choose Claim 3 test ADA & finish. This final reward uses the same wallet and can only be claimed once.'],
  ['complete', 'Activity complete', 'When the final payment confirms, Blockscholar shows 5 test ADA earned and saves both receipts with your work. Strike Training is optional practice after this completed program.'],
];

/** Screenshots of the actual component using isolated example data, never a learner's account. */
export function StrikeWorkshopGuide({ initialStep = 0 }) {
  const [step, setStep] = useState(initialStep);
  const [id, title, description] = screens[step];
  return <details className="sm-workshop-guide">
    <summary>See workshop steps</summary>
    <nav aria-label="Workshop screenshot steps">{screens.map(([key, name], i) => <button key={key} type="button" aria-label={`${i + 1}. ${name}`} aria-pressed={i === step} onClick={() => setStep(i)}>{i + 1}</button>)}</nav>
    <h3>{title}</h3><p>{description}</p>
    <figure><a href={`/images/blockscholar/${id}.png?v=20261023`} target="_blank" rel="noreferrer" aria-label={`Enlarge example: ${title}`}><img src={`/images/blockscholar/${id}.png?v=20261023`} alt={`Example DRMZ workshop screen: ${title}`} width="430" height="1000" loading="lazy"/></a><figcaption>Example screen · sample values, not your account. Trading controls in these screenshots are inactive. Tap the image to enlarge.</figcaption></figure>
  </details>;
}
