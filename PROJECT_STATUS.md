# AgentScore — Project Status & Handoff

Living handoff so a fresh session can continue with zero prior context. **To resume: read [`AGENTSCORE_BRIEF.md`](AGENTSCORE_BRIEF.md) (the binding source of truth), then this file.** Last updated 2026-07-19.

AgentScore is a verifiable **reputation + settlement layer and independent AI arbiter** for the agentic economy, built on Arc Testnet. Positioning: infrastructure any ERC-8183 job can plug into — not a freelance board.

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

Worker: the agent does **real deterministic work** (dedupe + risk-label a wallet dataset, $0, no LLM), hashes the actual output, submits it; the arbiter **re-derives the correct result and verifies** (schema / row count / no-duplicates / checksum-vs-onchain / exact-match) before `complete`, else `reject` + refund; verdict attested to the registry. 17 tests pass (`npm test`).

Scoring formula (also on the Arbiter page): start 50; +8 per approved settlement (diminishing to +2 after 10); −20 per rejected verdict; −10 per expired-unfunded abandonment; volume bonus up to +10 (log-scaled on lifetime USDC settled); clamp 0–100.

### Frontend (`web/`, Vite + React + TS + wagmi/viem + Tailwind v4 + shadcn/ui)
Pages: **Home** (agent showcase + secondary address lookup), **`/agent/:address`** (reputation profile), **`/hire/:address`** (create-job → fund-escrow flow, exact-amount approvals), **`/marketplace`** (M2M bounties + live onchain activity), **`/dashboard`** (connected-wallet jobs), **`/arbiter`** (address, integration snippet, verdict feed, methodology), **`/job/:id`** (live "Agent's Mind" terminal streaming real events + the deliverable panel), NotFound. Reads prefer the backend API with a graceful direct-chain fallback.

### Live proof (real, onchain — verify on Arcscan)
- **`#158635`** — first fully autonomous loop: Hire → agent setBudget → client fund → agent submit → arbiter complete + attest, zero human clicks after funding (client = the burner wallet).
- **`#158648`** — **real work verified + settled**: agent deduped 18→15 rows + risk-labeled, submitted that output's hash; arbiter re-derived, all 5 checks passed → 2 USDC released to the agent.
- **`#158649`** — **tampered → rejected + refunded**: faulty run left duplicates (18→18); arbiter caught it (✗ row count / ✗ no-duplicates / ✗ exact-match, though checksum held) → rejected, escrow refunded to the client.

Latest commit: `3cb2385`. Everything is committed; working tree clean.

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
| **Demo client** (scripts) | `0x02d2cFDB15Fe4D48820dF2431B2Bd3182636D34b` |
| **User burner client** | `0xA42306d86508225394A651d03Be3F7c82D83305b` |

All addresses are public. Their **private keys are testnet-only and live in gitignored `.env` files** (`backend/.env`, `arbiter/.env`) — never committed.

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
```

Do **not** also run `arbiter/run.mjs` — that standalone watcher is **superseded by the backend worker** and would double-act on the same jobs.

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

## 5. Remaining roadmap (in order)

1. **Circle tools integration** — Wallets, Nanopayments, and CCTP, to deepen the "settlement-native" story.
2. **Deploy** — frontend to Cloudflare Pages, read-only API to Cloudflare Workers (worker stays local). $0, no card. Deploy **once at the very end** to avoid redeploys.
3. **Publish repo to GitHub** — behind the privacy gate: enumerate exactly what will be pushed and get explicit approval first; confirm no secrets, no local paths, no username in history.
4. **3-minute video + submission package** — demo the autonomous loop and the real-work verify/reject, link Arcscan proofs, write the submission.

---

## 6. Repository layout

```
AGENTSCORE_BRIEF.md   source of truth (design, security, scope)
PROJECT_STATUS.md     this handoff
README.md             overview + roadmap (ERC-8004 interop noted)
contracts/            Foundry — AgentScoreRegistry + tests
backend/              Node+TS — reputation API + real-work arbiter worker (+ Dockerfile, wrangler.toml)
web/                  Vite React frontend (Tailwind + shadcn/ui)
arbiter/              legacy standalone watcher (superseded by backend worker); holds gitignored .env
```
