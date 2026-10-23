export const BLOCKSCHOLAR = Object.freeze({
  id: 'drmz-blockscholar-strike-01',
  title: 'Strike Foundations',
  sponsor: 'DRMZ stake pool',
  sponsorTicker: 'DRMZ',
  suiteHref: '/learn/blockscholar',
  fundHref: '/learn/dream-fund',
  worldHref: 'https://drmz.tech/spaces?place=stadium&area=strike',
  outcomes: [
    { title: 'Explain the exposure', evidence: 'Six short lessons on one page, then one eight-question quiz.', skill: 'Financial and digital literacy' },
    { title: 'Demonstrate a workflow', evidence: 'Set up and fund your practice wallet, then place, inspect and cancel on Strike testnet.', skill: 'Technical operations and evidence checking' },
    { title: 'Communicate your learning', evidence: 'Save a field note describing your evidence and a workplace application.', skill: 'Professional communication' },
  ],
});

export function programMilestones(practice, mission) {
  return [practice?.prepScore >= 6, !!mission?.completedAt, !!mission?.blockscholar?.reflection];
}

/** Resume the earliest unfinished step, including records earned before enrollment. */
export function nextProgramStep(practice, mission) {
  const steps = ['learn', 'mission', 'work'];
  const next = programMilestones(practice, mission).findIndex(done => !done);
  return steps[next < 0 ? 2 : next];
}

/** Educational price-only sensitivity; not a quote, liquidation model or trading recommendation. */
export function exposureExample(notional, movePercent, side = 'long') {
  if (!Number.isFinite(notional) || notional < 0 || notional > 100_000 || !Number.isFinite(movePercent) || Math.abs(movePercent) > 100 || !['long', 'short'].includes(side)) return null;
  return notional * movePercent / 100 * (side === 'short' ? -1 : 1);
}
