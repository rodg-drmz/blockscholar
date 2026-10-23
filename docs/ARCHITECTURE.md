# Architecture and trust boundaries

Browser → Next.js authentication and mission API → Strike testnet / Cardano Preprod.

## Identity and persistence

The public entry is wallet-only. Legacy email endpoints remain isolated from the entry UI to preserve existing records. Wallet login uses a nonce-bound signed challenge, verified on the server; a login signature does not authorize trading. Signed HttpOnly cookies identify a stable per-service account. Wallet and verified email linking retain the account identity. New hosting intentionally has a fresh identity store: the private DRMZ database is never exported.

Lesson progress is written atomically to account-specific protected JSON. Mission records, order checkpoints and payout outboxes are persisted in SQLite. Sign-out and reconnect do not discard records. Browser trading keys are ephemeral and must be re-authorized after reload.

## Strike and funding

The browser authorizes a trade-only Strike key through a Cardano wallet. The server prepares and validates narrowly scoped testnet requests. The learner reviews before signing. Deposits validate network, destinations, exact value and fees, and only complete after chain confirmation plus Strike credit verification.

Mission completion requires an open-order checkpoint and matching canceled order belonging to the linked account, with zero fills. Position missions separately verify their entry and close and pause if liquidity is unavailable. A response being accepted is not treated as a confirmed fill or completion.

Bounties are 2 test ADA for the verified mission plus a separate 3-test-ADA field-note completion reward, bounded by the pilot campaign cap, with account and wallet uniqueness checks. The practice sponsor grants 104 test ADA for a 100-test-ADA deposit, 2-test-ADA batcher fee and network costs. Each sponsor has a separate key and durable outbox. Payout retries recover the saved transaction instead of blindly sending again. These are test tokens, not earnings or a mainnet yield product.

## Hosting

One Railway service, one persistent volume, one process/replica. The public repository contains no secrets, account records or historical data. Server variables contain Resend/Blockfrost credentials, session secret and JSON encryption key. Sponsor private keys are created on the volume with owner-only permissions. JSON protection does not encrypt the SQLite mission database; host access remains a trust boundary. Backups must include the volume and separate encryption key under restricted access.

Mutating browser requests are same-origin. Authentication bodies are bounded; persistent global and per-recipient limits reduce email abuse. The deployment does not expose a generic trading proxy, private DRMZ administration or other products.

## Limits

Testnet service and market liquidity can fail. The server's verification of Strike API evidence is a trust assumption, not a ZK proof. One account/wallet does not imply one human. Public source makes quiz answers visible. Sponsor budgets and pilot caps bound exposure, but stronger eligibility is future work. These constraints must remain visible when describing results.
