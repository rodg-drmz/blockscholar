# Release boundary

This is a fresh, source-only export of DRMZ Blockscholar. No private repository history, runtime records, user data or credentials are included. The demo uses its own records and testnet sponsor wallets. Existing DRMZ accounts, records and production services are not migrated or altered.

Shared domain code preserves the tested program, Strike account/order/deposit verification, persistent progress and payout outbox. The standalone shell and sign-in screen are specific to this release and are validated separately. Login establishes a Blockscholar session; Strike trading still requires explicit wallet authorization. A reload requires reconnecting the in-memory trading key.

The full Spaces engine, Quorum, Oneirium and academic infrastructure remain in the private DRMZ application. The public release is self-contained and does not include navigation to the private DRMZ products.

## Hosted release — October 23, 2026

- Public source: https://github.com/rodg-drmz/blockscholar
- Dedicated demo: https://blockscholar-production.up.railway.app/learn/blockscholar
- Fresh source history, separate Railway service and persistent volume, fresh session/encryption secrets, separate Preprod funding and bounty wallets.
- 63 automated tests passed; production build/type validation passed; GitHub Actions passed.
- Patched Next.js/viem and pinned patched transitive packages after dependency audit; npm reported zero known vulnerabilities at release time.
- Live HTTP smoke test: synthetic EVM wallet sign-in, one-time challenge replay rejection, cross-site mutation rejection, lesson score saved and restored as 8/8 after signing out and back in, unearned bounty claim rejected.
- Hosted email provider accepted a test sign-in email. Inbox delivery and the user's final phone sign-in still need confirmation.
- Phone-width rendering checked at 390 CSS pixels: no horizontal overflow; exposure calculator updated correctly.
- Sponsor funding is confirmed: 420 Preprod test ADA for practice funding and 50 for bounties. The real hosted phone deposit/order/cancel/bounty run is still pending; prior tests of the private source application are not presented as a completed run on this new host.

## Mission entry fix — October 23, 2026

- Fixed a client-side exception when opening Mission before linking a Strike wallet. Missing account IDs compared equal and caused the screen to read a funding response that did not exist yet.
- Unknown balances now stay unknown until a response matches a linked account. Applied the same guard to wallet setup.
- Added React rendering regression tests for signed-out learners, fresh records, readiness saved without a wallet, and linked accounts awaiting funding checks. All 69 tests and the production build/type validation passed.
- No authentication, progress storage, deposit, order, or bounty payment logic changed.

## Resume after sign-in — October 23, 2026

- Program navigation now records the selected step in its URL. Wallet sign-in reloads and email sign-in links return to that step instead of the program beginning.
- New guest preparation attempts retain their answers and submit them for server grading after sign-in. Best scores are preserved; successful transfers are not repeated and are bound to the first signed-in account. No rewards or trading evidence are imported.
- Older guest results without saved answers remain explicitly browser-only, so those learners can continue Mission without repeating the lessons. A later quiz attempt can save preparation to the account.
- Added coverage for view restoration, guest-to-account grading, retries, unavailable storage, and account isolation. 76 automated tests pass.

No private DRMZ service was redeployed for this release. Existing local and hosted records remain where they were. This public demo uses fresh progress records.

## Clear wallet and deposit progress — October 23, 2026

- Standalone sign-in is now a single wallet-only panel. Removed email entry and references to signing in with a DRMZ account; existing records are preserved. Workshop connection controls only appear after sign-in.
- Connection approval now appears directly below its Connect button. Connected wallet controls disappear; completed funding and transaction details move into Wallet & receipts.
- Distinguishes Cardano payment confirmation from verified Strike trading credit. Pending deposits show automatic checks, a last-checked time, a manual retry, and visible connection errors. No repeat payment is requested.
- Receipt checks run before registration retries, so an expired browser signing session or failed registration cannot prevent checking an already settled deposit. Checks resume when returning to the page. Only the existing verified receipt unlocks the workshop.
- Simplified learner-facing copy and preserved fee/destination review before signing.
- 82 automated tests and production build/type validation passed. The learner's current deposit still needs its public receipt checked; this UI release does not certify that payment as settled or the full phone bounty flow as complete.

## Complete program and interface polish — October 23, 2026

- Synced the latest Blockscholar program and workshop from local development into this standalone public app. Kept the demo's independent account store, sponsor keys and persistent volume.
- Illustrated wallet-only welcome, larger heading, separated DRMZ Web3 / Strike branding and one Connect wallet action. Sign out / change wallet is available inside the program; NuFi is excluded. Removed external Learn/Spaces navigation.
- Three aligned Program steps, centered content, completed markers and a purple highlight on the next unfinished step. Training, My work and Dream Fund unlock after the learning milestones.
- Reuse the wallet connection from login. Reuse Strike permission within the current tab for the same account and key; clear it on sign-out. Full reload can require a new Strike authorization because trading secrets remain memory-only.
- Reconcile canceled orders before asking for another signature or retrying cancellation. Keep inline status and errors beside the relevant action.
- Reuse the mission's verified Preprod wallet for the 2-test-ADA bounty. Added a separate 3-test-ADA field-note claim, guarded by prior mission reward confirmation, saved reflection and account/wallet eligibility. Both payouts use durable outboxes, shared sponsor locking and exact-output confirmation checks.
- Added automatic field-note receipt checks and an Activity complete display with 5 test ADA total. Dream Fund includes both rewards and their funding capacity.
- Replaced the workshop guide with nine current mobile-sized screenshots, including deposit review, field note and completion. These are real component captures with illustrative data, not fabricated live transaction receipts.
- Removed the black matte behind the header Ouroboros through artwork blending.
- Validation: 100 automated tests passed, TypeScript passed and production build passed. Coverage includes login signature/replay handling, saved progress, wallet handoff, tab-session reuse, order cancellation and reward safeguards.
- User acceptance on the local implementation confirmed the same-account order/cancel workflow and both 2 + 3 test ADA payouts, followed by Activity complete. Testnet transaction and Strike settlement latency remains external to the UI; long/short execution remains liquidity-dependent.

The Dream Fund's future scholarship and work-based-learning programs are a roadmap. This demo pays testnet learning rewards; it does not promise investment returns or certify mainnet readiness.
