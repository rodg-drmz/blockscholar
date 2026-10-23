# Blockscholar · Strike Foundations

**Learn it. Try it on Strike. Verify the work. Claim a learning bounty.**

[Download the 2½-minute demo video](https://github.com/rodg-drmz/blockscholar/releases/download/demo-2026-10-23/Blockscholar-demo.mp4) · [Open the hosted demo](https://blockscholar-production.up.railway.app/learn/blockscholar) · [Strike testnet](https://testnet.strikefinance.org/) · [Architecture](docs/ARCHITECTURE.md) · [Demo walkthrough](docs/DEMO.md)

Blockscholar is a DRMZ-sponsored learning program that takes a learner from perpetuals fundamentals into an actual Strike testnet workflow. It pairs short lessons and scenarios with verified protocol activity and a funded Cardano Preprod bounty. The Dream Fund makes the sponsor's budget, payments, and remaining capacity visible.

This is a standalone, source-available hackathon release extracted from DRMZ. The private DRMZ application, databases, wallet keys, and repository history are not included. The public demo is self-contained; other DRMZ products are not included.

## Try it

1. Connect a supported wallet on the welcome page. The demo has its own accounts and saved progress, separate from drmz.tech.
2. Follow Program: six lessons together, an exposure calculator, and a preparation quiz.
3. Enter **Your DeFi Workspace** with a Cardano Preprod wallet. The existing login connection is reused where available; Strike trading permission is a separate explicit approval.
4. Request sponsored practice funding if eligible, review the deposit and fees, and wait for verified Strike credit. Existing funded Strike accounts can be reused.
5. Prepare a small post-only ETH-USD buy limit, review and place it, then inspect the API-verified open order. Cancel that same order and verify its canceled, zero-fill state.
6. Claim **2 test ADA** to the mission's verified wallet. Write and save your field note, then claim **3 more test ADA** to finish: **5 test ADA total**, subject to available sponsor funding. Saved receipts prevent duplicate payouts.

The Program highlight follows the next unfinished step. Training, My work and Dream Fund navigation unlock when the three learning milestones are saved. A field-note payout remains pending until its Cardano receipt is confirmed; the UI then marks the rewarded activity complete.

Test ADA and test USD have no monetary value. No real funds are required. Long/short scenario missions are also included, but executing and closing positions depends on testnet order-book liquidity; the app pauses instead of claiming completion or endlessly retrying.

## What is integrated

- Strike testnet builder account authorization, balances, official deposit flow, orders, cancellations and position checks.
- Per-user trade signing keys held in browser memory; reconnect after reload. No shared server trading key impersonates learners.
- Backend validation of account ownership, matching order checkpoints and zero fills before completion.
- Persistent wallet identities, lesson scores, mission evidence, field notes and resumable payment requests.
- Separate, capped practice-funding and bounty sponsor wallets; repeat requests reuse saved payment state.
- Dream Fund balance and aggregate program activity, with Cardano explorer receipts for confirmed payments.
- Native Cardano, EVM, Solana and Midnight message-signature authentication. The workshop itself requires Cardano Preprod.

This release does **not** implement Midnight ZK learning credentials, mainnet trading, a pooled investment fund, district endorsement or academic credit. Its evidence digest records API verification; it is not a zero-knowledge proof. Quiz answers are inspectable in this public source; real protocol evidence, not quiz secrecy, gates the pilot bounty.

## Run locally

Requires Node.js **22.16+** (uses `node:sqlite`).

```sh
npm ci
cp .env.example .env.local
# Configure the server-only values described below.
npm run dev
```

Visit `http://127.0.0.1:3000/learn/blockscholar`. Configure a random 32+ character `DRMZ_APP_SESSION_SECRET`, a **Cardano Preprod** Blockfrost project token, and an active **Strike testnet** builder code. Never put these in `NEXT_PUBLIC_*` variables. Example random secret generation: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

For sponsored funding, initialize new wallets with `node --env-file=.env.local scripts/init-sponsors.mjs`; it prints only their public addresses. Fund them with **Preprod test ADA only**. The bounty wallet and the practice wallet are different. Do not copy production keys or existing sponsor state into a fresh database. Local example encryption is off; on hosted deployments enable it and set a separate 32-byte `DRMZ_LOCAL_DATA_ENCRYPTION_KEY`.

```sh
npm test
npm run typecheck
npm run build
# next start does not load env into the wrapper; use an explicit environment file locally:
node --env-file=.env.local scripts/start.mjs
```

## Deploy

The included Dockerfile and Railway configuration run one app instance with a persistent volume. Mount `/data/blockscholar`, set `DRMZ_LEARN_DATA_DIR=/data/blockscholar` and `STRIKE_MISSIONS_DATA_DIR=/data/blockscholar/strike-missions`, and configure the server variables from `.env.example`. Set `APP_ORIGIN` to the canonical HTTPS demo URL. The startup script creates separate sponsor wallets only when missing; existing wallets are preserved.

Back up the volume and encryption key securely. Never commit backups. Keep one replica: the SQLite store and payment leases are designed for this pilot's single instance. Health is available at `/api/health`; sponsor funding status is visible in Dream Fund. A configured service is not necessarily a funded service.

## Scope and status

This release includes automated tests for signature verification/replay protection, identity restoration, saved practice, account-bound mission checkpoints, order handling, deposit validation, and payout recovery. User testing completed the funded order/cancel workflow and saved completion. The latest local acceptance run confirmed both the 2-test-ADA mission payment and the 3-test-ADA field-note payment to the same verified wallet. Consult [release notes](RELEASE-NOTES.md) for current validation.

There are no secrets or runtime records in this repository. Report sensitive issues privately to the repository owner; do not publish keys, student information, or wallet recovery material in issues.

## Rights and attribution

DRMZ / Blockscholar application source is published for inspection and hackathon evaluation. No general open-source license has been granted in this release. DRMZ artwork and branding are reserved to their owners. Strike's name/logo identify the integrated protocol and do not imply endorsement. Third-party packages retain their own licenses. See [NOTICE](NOTICE.md).
