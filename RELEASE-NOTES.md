# Release boundary

This is a fresh, source-only export of DRMZ Blockscholar. No private repository history, runtime records, user data or credentials are included. The demo uses its own records and testnet sponsor wallets. Existing DRMZ accounts, records and production services are not migrated or altered.

Shared domain code preserves the tested program, Strike account/order/deposit verification, persistent progress and payout outbox. The standalone shell and sign-in screen are specific to this release and are validated separately. Login establishes a Blockscholar session; Strike trading still requires explicit wallet authorization. A reload requires reconnecting the in-memory trading key.

The full Spaces engine, Quorum, Oneirium and academic infrastructure remain in the private DRMZ application. The public release links to DRMZ Spaces; it does not claim to include the entire metaverse application.

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
