# AgentScore — Project Status

Current state of the project: what is built and proven, key addresses and network facts, run commands, and the remaining roadmap. Last updated 2026-07-21.

AgentScore is the **credit and trust infrastructure for the machine economy**, built on Arc Testnet: verifiable reputation determines the terms autonomous agents get, an independent AI arbiter settles their disputes, and financial primitives (credit, insurance) are built on top. Infrastructure any ERC-8183 job can plug into — not a freelance board.

---

## 1. What's built and proven

### Contracts (`contracts/`, Foundry)
- **AgentScoreRegistry** — data-only Solidity (agent profiles + arbiter verdict attestations). **Holds no funds, no payable functions.** OpenZeppelin AccessControl, custom errors, input caps. Full test suite green (`forge test`), 100% coverage on the contract.
- **Deployed** to Arc Testnet at `0x1489b56AaE4BB63e9793a151C12964B19bC99d38`. Deployer = arbiter, so the arbiter holds `DEFAULT_ADMIN_ROLE` + `ARBITER_ROLE`.

### Backend (`backend/`, Node + TS, Hono + viem)
Reputation API + always-on arbiter worker. Reads via dRPC + the Arcscan log API. Runs on Node (API + worker) and Cloudflare Workers (API-only, `src/cf.ts`).

Endpoints:
- `GET /health` — chain head, arbiter, registry, worker status
- `GET /agents` — agent directory (live vs demo)
- `GET /agent/:address` — **computed reputation** (score, breakdown, metrics, job history) from chain
- `GET /jobs` — recent ERC-8183 jobs
- `GET /arbiter/verdicts` — verdicts our arbiter attested to the registry
- `GET /deliverable/:jobId` — the real work product + the arbiter's verification checks (Node-only)
- `GET /nanopayments/:jobId` — the Circle Nanopayments per-row ledger for a job, off-chain rows + on-chain deposit/withdraw-mint (Node-only)

Worker — **two verification models**: *verifiable computation* (the agent dedupes + risk-labels the dataset, $0/no LLM, and the arbiter **re-derives** the answer and checks schema / row count / no-duplicates / checksum-vs-onchain / exact-match) and *judged quality* (`[JUDGED]` jobs: the agent writes a real analyst memo with an LLM, and the arbiter **evaluates it against the spec with its own LLM call on a different model family** — never re-deriving — scoring a rubric and attesting a written reason). Settle → `complete`, fail → `reject` + refund; verdict attested to the registry. 37 tests pass (`npm test`).

Scoring formula (also on the Arbiter page): start 50; +8 per approved settlement (diminishing to +2 after 10), **weighted by client diversity** (the k-th settlement from the same client counts fully up to 3, then 3/k — self-farming decays); −20 per rejected verdict (**never** diversity-discounted — failures can't be laundered); −10 per expired-unfunded abandonment; volume bonus up to +10 (log-scaled on diversity-weighted USDC settled); clamp 0–100. Collateral mirror jobs excluded from all scores. The weighting applied to us too — Lexica's redemption settle paid +5, not +8. Documented limitation: distinct-wallet Sybil farming still works at linear cost (roadmap: stake-weighting + ERC-8004 identity).

### Frontend (`web/`, Vite + React + TS + wagmi/viem + Tailwind v4 + shadcn/ui)
Pages: **Home** (agent showcase + secondary address lookup), **`/agent/:address`** (reputation profile), **`/hire/:address`** (create-job → fund-escrow flow, exact-amount approvals), **`/marketplace`** (M2M bounties + live onchain activity), **`/dashboard`** (connected-wallet jobs), **`/arbiter`** (address, integration snippet, verdict feed, methodology), **`/job/:id`** (live "Agent's Mind" terminal streaming real events + the deliverable panel), NotFound. Reads prefer the backend API with a graceful direct-chain fallback.

### Live proof (real, onchain — verify on Arcscan)
- **`#158635`** — first fully autonomous loop: Hire → agent setBudget → client fund → agent submit → arbiter complete + attest, zero human clicks after funding (client = the burner wallet).
- **`#158648`** — **real work verified + settled**: agent deduped 18→15 rows + risk-labeled, submitted that output's hash; arbiter re-derived, all 5 checks passed → 2 USDC released to the agent.
- **`#158649`** — **tampered → rejected + refunded**: faulty run left duplicates (18→18); arbiter caught it (✗ row count / ✗ no-duplicates / ✗ exact-match, though checksum held) → rejected, escrow refunded to the client.

### Phase 1 — real AI agent + real AI arbiter (judged-quality jobs, live)
`[JUDGED]` jobs (`backend/src/lib/judged.ts`): the agent writes a genuine analyst memo (`llama-3.3-70b-versatile`); the arbiter evaluates it against the spec with its **own** LLM call on a **different model family** (`openai/gpt-oss-120b`), scoring a rubric and writing a reason — it judges, never re-derives. **`reasonHash` = keccak of the written reasoning**, committed onchain in `complete`/`reject` + the attestation; the job page recomputes it client-side and shows the "hash matches onchain" check. $0 (Groq free tier); a missing key or rate-limit **fails loudly — a verdict is never fabricated**. Proofs: **`#158793`** judged pass (the arbiter caught a real flaw — a wrong wallet citation — scoring grounding 7/10) and **`#158794`** judged reject (lazy off-spec memo, 1/2/0/0). Demo: `LLM_API_KEY=… npm run demo:judged`.

### Phase 2 — reputation → credit terms (economic consequence, live)
`backend/src/lib/credit.ts` maps the live score to terms: **≥80 credit** (30% direct advance + 70% escrow), **50–79 standard** (full escrow), **<50 collateral** (50% slashable). No new Solidity: the advance is a direct client→agent transfer; collateral is a **mirror job on the same ERC-8183 reference** (agent funds, client is provider, arbiter is evaluator) — Circle's audited escrow custodies it, our contracts still hold no funds. Slash = arbiter `complete`s the mirror (pays the client); release = `reject` (refunds the agent). Terms are recorded in the main job's onchain `[TERMS …]` description; the worker gate refuses work until the advance/collateral is verified onchain. Proofs: **`#158800`** collateral released (Lexica redemption), **`#158802`/`#158803`** collateral **slashed** to the client, **`#158808`** credit hire with a real 0.6 USDC advance. Demo: `npm run demo:credit -- all`.

### Circle developer tools (live on Arc Testnet)
- **Nanopayments + Gateway** (`backend/src/lib/nanopay.ts`) — the enrichment agent is paid **per row** in micro-USDC over x402 (gasless EIP-3009), settled by **Circle Gateway**, run **alongside** the escrow (never replacing it): off-chain batched per-row settlements plus an on-chain Gateway **deposit** (`0xdb66f74f…`) and agent **withdraw-mint** (`0x49390833…`), surfaced on the job page with an explicit off-chain-vs-on-chain split. Permissionless on testnet — no Circle API key. Gated by `NANOPAY_ENABLED` (default off). Demo: `NANOPAY_ENABLED=1 npm run demo:nanopay`.
- **Wallets (developer-controlled)** — a Circle Wallet signs as a **separate** "Circle-signed" agent (`0xC5143cCdF93A90eC0D2e30A62F36E36D4CB0Ef2c`), selected by `SIGNER_MODE=circle` (default `raw`). In job **`#158772`** it signed `setBudget` + `submit`; the raw-key arbiter verified + settled. The proven agent `0x939A…` and every existing proof are untouched. Provision: `npm run circle:setup`; demo: `SIGNER_MODE=circle npm run demo:circle`.
- **Paymaster** — deliberately **skipped**: USDC is already Arc's native gas token, so it is redundant (and Arc isn't on Circle Paymaster's chain list). Documented as a considered choice.
- Fresh escrow reproductions proving the loop is intact after these additions: **`#158721`** (settle) and **`#158723`** (reject + refund).

### Live deployment ($0, no card — always-on)
- **Frontend:** https://agentscore-app.pages.dev (Cloudflare Pages, static `dist/`; bundle verified to contain no secrets).
- **Read-only API:** https://agentscore-api.devorun.workers.dev (Cloudflare Worker, `src/cf.ts`; public vars only, no keys).
- **Settlement worker:** `agentscore-worker` — Cloudflare **Cron Trigger every minute** (`src/cron.ts`, `wrangler.worker.toml`). It performs the agent + arbiter steps so **a visitor's hire settles with no local machine running**. Its `fetch` URL (https://agentscore-worker.devorun.workers.dev) is a read-only "what it sees / would do" status view.
- **Proven:** job **`#158980`** was hired and settled entirely by the cloud worker with the local signer off — priced at 0:58, deliverable submitted at 1:56, completed + attested on a later tick. A fresh hire settles in **~4 minutes** (one action-pair per minute tick).
- **Free-tier design.** Measured headroom: the enforced CPU budget is ~10k–25k chained keccaks, and a two-transaction invocation still passes with 6k extra hashes — the real workload uses roughly **half** the budget. Enforcement is **adaptive** (one overrun degrades later invocations), so the worker runs cool: receipt-free sends with local nonces, one multicall for reads, topic-filtered `eth_getLogs` capped at **9,000 blocks** (Arc RPCs reject larger ranges), and a hard cap of **2 transactions per tick**. Stateless — every tick re-derives from chain, so it is idempotent and needs no KV.
- **Keys:** `AGENT_LEXICA_PRIVATE_KEY` + `ARBITER_PRIVATE_KEY` are Cloudflare **Workers secrets** (`wrangler secret put`), testnet-only, never in the repo. This is a deliberate posture change from "keys never leave the local machine", bounded because these are valueless faucet wallets and our contracts hold no funds.
- **Cloud vs local scope (stated plainly):** the cloud worker settles **deterministic** jobs only. `[JUDGED]` jobs are skipped (and logged) because they need an LLM call plus a shared deliverable store; they remain a local-worker path, with completed proofs **`#158793`** / **`#158794`**. The cloud API also does not serve `/deliverable/:jobId` or `/nanopayments/:jobId` — both are disk-backed and Node-only — so those panels render only against a local API. The hosted frontend closes the gap for the two judged proofs: their full records (memo, rubric, written reasoning) **ship as static app data** (`web/src/lib/showcase-records.json`) and render through the same panels, with the browser recomputing `keccak(reasoning)` and matching the onchain verdict event — **authenticity is verified against the chain in the visitor's browser, not taken on trust** (a live API record always takes precedence over the bundle), and the UI states the split plainly. The hire input also **strips reserved markers** (`[JUDGED]`, `[LAZY]`, `[BAD]`, `[TERMS …]`, `[COLLATERAL]`) before a job is created and tells the visitor exactly what was removed, so a mistyped marker can't create a job the cloud worker would skip or gate and strand the escrow until expiry.

Everything above is committed; working tree clean.

---

## 2. Key addresses & network

| Name | Address / value |
|---|---|
| Chain ID | `5042002` (0x4CEF52) |
| RPC (in use) | **dRPC** — `https://arc-testnet.drpc.org` |
| RPC fallback | thirdweb — `https://5042002.rpc.thirdweb.com` |
| Explorer | `https://testnet.arcscan.app` |
| Faucet | `https://faucet.circle.com` |
| ERC-8183 reference (AgenticCommerce) | `0x0747EEf0706327138c69792bF28Cd525089e4583` |
| ERC-20 USDC (6 decimals) | `0x3600000000000000000000000000000000000000` |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` |
| **AgentScoreRegistry (ours)** | `0x1489b56AaE4BB63e9793a151C12964B19bC99d38` |
| **Arbiter** (evaluator, admin) | `0x5d474e5125D7ee1a63EE2f2444a88e2a518683E9` |
| **Agent** (provider, "Lexica") | `0x939ABdD89fE9C5aAC54615f56c50901acf5E6918` |
| **Circle-signed agent** (developer-controlled Circle Wallet, `SIGNER_MODE=circle`) | `0xC5143cCdF93A90eC0D2e30A62F36E36D4CB0Ef2c` |
| **Demo client** (scripts) | `0x02d2cFDB15Fe4D48820dF2431B2Bd3182636D34b` |
| **User burner client** | `0xA42306d86508225394A651d03Be3F7c82D83305b` |

All addresses are public. The raw-key wallets' **private keys are testnet-only and live in gitignored `.env` files** (`backend/.env`, `arbiter/.env`) — never committed. The **Circle-signed agent's key is custodied by Circle** (developer-controlled wallet); we hold only `CIRCLE_API_KEY` + `CIRCLE_ENTITY_SECRET` in gitignored `backend/.env`, with the recovery file in gitignored `backend/.circle/`.

**Why dRPC, not the official RPC:** the official `rpc.testnet.arc.network` rate-limits hard under load (measured 3/24 requests OK in a burst; 21 × HTTP 429), which broke live flows. dRPC and thirdweb both handled 24/24. We switched reads, the worker, and the wallet network params to dRPC.

Native gas token on Arc is **USDC (18 decimals)**; the ERC-20 view at `0x3600…` is the same balance at **6 decimals**. Never show "ETH"; never mix the decimals.

---

## 3. Running services & start commands

Prerequisites on PATH: Node 24 + npm, and Foundry (`forge`/`cast`) for contracts. Env files must exist (recreate from the `.env.example` files with the testnet keys if cloning fresh): `backend/.env`, `web/.env`, `arbiter/.env`.

```
# Backend — reputation API + always-on arbiter worker (port 8787)
cd backend && npm install && npm start

# Frontend — Vite dev server (port 5173)
cd web && npm install && npm run dev

# Run the two-job demo (backend must be running): real settle + tampered reject
cd backend && npm run demo

# Circle developer tools (optional; Arc Testnet, $0, no card)
cd backend && NANOPAY_ENABLED=1 npm run demo:nanopay   # per-row nanopayments over Gateway
cd backend && npm run circle:setup                     # provision the developer-controlled Circle Wallet (writes CIRCLE_* to .env)
cd backend && SIGNER_MODE=circle npm run demo:circle   # one Circle-signed job (Circle wallet signs setBudget + submit)

# Phase 1/2 demos ($0; judged needs the free-tier LLM_API_KEY in backend/.env)
cd backend && npm run demo:judged                      # judged-quality: memo → pass, lazy memo → reject (LLM arbiter)
cd backend && npm run demo:credit -- all               # credit terms: collateral+redemption, slash, and a credit hire
```

Do **not** also run `arbiter/run.mjs` — that standalone watcher is **superseded by the backend worker** and would double-act on the same jobs.

**Operational rule (binding while the cloud cron is scheduled):** the local backend runs **`npm run api`** (read-only), **never `npm start`** — the cloud `agentscore-worker` is the signer, and a second local signer would double-act on the same jobs. To demo the local worker (e.g. judged jobs), first pause the cloud cron (`crons = []` in `wrangler.worker.toml` + `npx wrangler deploy --config wrangler.worker.toml`), then `npm start`.

Checks: `cd contracts && forge test` · `cd backend && npm test` · `cd web && npm run typecheck && npm run lint && npm run build` · Playwright specs in `web/tests`.

---

## 4. Key decisions & constraints (binding)

- **Our contracts never hold user funds.** All escrow stays in the ERC-8183 reference contract; our registry is data-only.
- **Exact-amount USDC approvals only** — never unlimited.
- **Arc Testnet only. No real funds.** All USDC is valueless faucet tokens.
- **The arbiter must never be the client** — it is an independent evaluator. Demo jobs use the separate demo-client wallet.
- **$0, no-credit-card hosting:** read-only API → Cloudflare Workers free tier (`backend/wrangler.toml`, `nodejs_compat`); the always-on signing worker → run locally (no free serverless allows a long-running signer); frontend → Cloudflare Pages. `Dockerfile` provided for a single always-on container if ever wanted.
- **Binding privacy rule:** nothing read, committed, or uploaded outside the project folder; before any egress (git push, deploy, upload) show the exact file/data list and wait for explicit approval; keep Windows username and absolute local paths out of all code, configs, README, reports; only the built `dist/` is ever uploaded to Cloudflare. No secrets in the repo.
- **Arc brand rules:** product name contains no "Arc"; relationship phrasing is "Built on Arc"; first prose mention "Arc Network" then "Arc"; footer carries "Arc is a trademark of Circle Internet Group, Inc." We use a **text** "Built on Arc" lockup (the official Arc logomark was not fetched/verified; do not recreate or recolor it).
- **No monospace anywhere except** the "Agent's Mind" terminal panel and the arbiter integration code snippet.
- **Dark + light themes** — default dark, navbar sun/moon toggle, persisted to localStorage, honors system preference. Inter for all UI/numbers (tabular figures); verified it actually loads.

---

## 5. Roadmap

Positioning: reputation determines terms, the arbiter settles disputes, financial primitives build on top.

Product phases (in order):

1. ✅ **Real AI agent + real AI arbiter** — DONE (§1): `[JUDGED]` jobs, LLM arbiter on a different model family, hash-committed written reasoning; deterministic path preserved as the second model.
2. ✅ **Reputation → credit terms + collateral** — DONE (§1): score-gated advance / escrow / slashable collateral, plus client-diversity weighting against self-farming.
3. **Agent-to-agent hiring + streaming payments + EURC multi-currency** — next.
4. **Insurance pool + ERC-8004 interop.**
5. **SDK + live economy map + 24/7 autonomous economy.**

Circle stretch (independent of the phases): **CCTP cross-chain hire** — fund an Arc job with USDC held on another testnet, via Arc App Kit's Bridge. Circle Nanopayments + Gateway + developer-controlled Wallets are already live (§1).

Ship steps: ✅ deployed — frontend on Cloudflare Pages (`agentscore-app.pages.dev`), read-only API + always-on settlement cron on Cloudflare Workers, $0/no card, registry source **verified on Arcscan**. Remaining: publish to GitHub behind the privacy gate (enumerate files, explicit approval, no secrets/local paths/username); 3-minute video + submission package linking the Arcscan proofs.

### Post-submission

- **Judged jobs on the cloud worker (KV-backed).** Today judged (`[JUDGED]`) jobs run only on the local worker; the two proofs (`#158793` / `#158794`) reach the hosted app as **bundled static records, chain-verified in the browser**. Moving the judged path fully onto the cloud cron needs two additions: (1) a **Cloudflare KV** deliverable store — the cron writes the memo + rubric + written reasoning keyed by jobId on submit/settle, and the API worker serves `/deliverable/:jobId` from KV (replacing the disk-backed, Node-only store and retiring the static bundle); (2) an **LLM binding** for the agent's memo and the arbiter's independent evaluation (the Groq key as a Workers secret, or Workers AI). **CPU budget — measured to fit.** The judged path's added on-worker CPU is a single `keccak(reasoning)` plus JSON (de)serialization; the LLM round-trip is network I/O and does not count against Cloudflare's CPU-time limit. Against the measured headroom (the deterministic workload already uses ≈half the enforced ~10k–25k-keccak budget, with ~6k hashes to spare on a two-transaction tick), that increment is negligible — **CPU is not the blocker; the KV store and the LLM binding are the work.** It stays inside the existing 2-transactions-per-tick and adaptive-CPU envelope.

---

## 6. Repository layout

```
PROJECT_STATUS.md     project status (this file)
README.md             overview + roadmap (ERC-8004 interop noted)
contracts/            Foundry — AgentScoreRegistry + tests
backend/              Node+TS — reputation API + arbiter worker; judged-quality (lib/judged.ts) + credit terms (lib/credit.ts); Circle nanopayments (lib/nanopay.ts), signer adapter (lib/signer.ts); demo-{judged,credit,nanopay,circle}.ts, circle-setup.ts; cloud: cf.ts (API worker, wrangler.toml), cron.ts (settlement cron, wrangler.worker.toml), probe.ts (parked CPU probe, wrangler.probe.toml) (+ Dockerfile)
web/                  Vite React frontend (Tailwind + shadcn/ui)
arbiter/              legacy standalone watcher (superseded by backend worker); holds gitignored .env
```
