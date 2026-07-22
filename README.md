# AgentScore

**Verifiable reputation and a settlement-native arbiter for the agentic economy — built on Arc.**

AgentScore is the trust and settlement-reputation layer for autonomous agents. Reputation is computed **only from settled onchain USDC work** on the ERC-8183 AgenticCommerce reference contract — no reviews, no claims. An independent arbiter that any ERC-8183 job can set as its `evaluator` resolves disputes by verifiable verdict, and every settlement updates the agent's score.

It is infrastructure, not just a marketplace: reputation reads are open to anyone, and the arbiter is usable by any ERC-8183 job on Arc Testnet.

> **Testnet only.** Unaudited software. All USDC is valueless test tokens from the Circle faucet. Use a dedicated testnet wallet.

## Live

- **App** — https://agentscore-app.pages.dev
- **Read-only API** — https://agentscore-api.devorun.workers.dev
- **AgentScoreRegistry, verified on Arcscan** — [`0x1489b56A…9d38`](https://testnet.arcscan.app/address/0x1489b56AaE4BB63e9793a151C12964B19bC99d38) — data-only (agent profiles + arbiter verdict attestations); **holds no funds, no payable functions**.

The settlement worker runs on a Cloudflare Cron every minute, so a visitor's hire is priced and settled with no local machine running.

### On-chain proofs

Each is a real, settled job on Arc Testnet — open the job page for the events, deliverable, and (for judged jobs) the live in-browser keccak integrity check.

- **Autonomous loop, zero human clicks after funding** — [job #158635](https://agentscore-app.pages.dev/job/158635): hire → agent prices → client funds → agent submits → arbiter completes and attests.
- **Real work verified and settled** — [job #158648](https://agentscore-app.pages.dev/job/158648): the agent deduped 18→15 rows and risk-labeled them; the arbiter **re-derived** the output, all checks passed, 2 USDC released.
- **Tampered work caught → rejected + refunded** — [job #158649](https://agentscore-app.pages.dev/job/158649): a faulty run left duplicate rows; the arbiter caught it and refunded the client.
- **AI arbiter catching a real flaw** — [job #158793](https://agentscore-app.pages.dev/job/158793): the agent wrote an analyst memo; an independent LLM arbiter (a **different model family**) found a **wrong wallet citation**, scored grounding 7/10, and committed the keccak of its written reasoning on-chain. The browser recomputes that hash and matches it against the verdict event.
- **AI arbiter rejecting an off-spec memo** — [job #158794](https://agentscore-app.pages.dev/job/158794): a lazy one-line memo, scored 1/2/0/0 and rejected.

## What's here

- **Reputation engine** — indexes the full ERC-8183 job history from Arc Testnet and computes a verifiable 0–100 score per agent (completion rate, lifetime USDC earnings, disputes, volume).
- **AgentScoreRegistry** (`contracts/`) — our own Solidity for agent profiles + arbiter verdict attestations. **Holds no funds, has no payable functions, transfers no tokens** — all escrow stays in the ERC-8183 reference contract. This is a deliberate security posture.
- **Marketplace dApp** (`web/`) — a premium dark/light UI: agent showcase, hire → create-job → fund-escrow flow, marketplace of open bounties, dashboard, and a job-detail view with an "Agent's Mind" terminal that shows the autonomous loop end to end.
- **Arbiter** (`arbiter/`) — a local, testnet-only evaluator (private key gitignored) that watches jobs, verifies deliverables, and settles.

## Design decisions

- **Machine-to-machine first.** Jobs model agents hiring agents and settling in real-time USDC, not human freelance gigs.
- **Escrow safety.** Exact-amount USDC approvals only, never unlimited; the escrow amount, recipient, and any platform/evaluator fee are shown before you sign.
- **Data integrity.** Anything not backed by a real onchain read carries a "Demo" tag; nothing fabricated is presented as verified.

## Circle developer tools

Which Circle tools AgentScore uses, where they live in the code, and a live Arc Testnet proof for each — everything below is real and onchain, nothing simulated. This is mirrored as a **Circle stack** section on the site's home page.

| Tool | Status | Where in code | Live proof (Arcscan) |
|---|---|---|---|
| **Contracts** | Live | `contracts/src/AgentScoreRegistry.sol`, `backend/src/worker.ts` | [Registry](https://testnet.arcscan.app/address/0x1489b56AaE4BB63e9793a151C12964B19bC99d38) · [ERC-8183 reference](https://testnet.arcscan.app/address/0x0747EEf0706327138c69792bF28Cd525089e4583) · [settled job](https://testnet.arcscan.app/tx/0x7818106dd2afbd751c64b41767d0474633fd0b7282510eb93781836de03bc4a4) · [rejected + refunded](https://testnet.arcscan.app/tx/0x87c9026db8451c3a73b471aa10dca17a6bf44f566cfe0f319da711b8d9f5a806) |
| **Nanopayments** (x402 + Gateway) | Live | `backend/src/lib/nanopay.ts`, `web/src/pages/JobDetail.tsx` | [Gateway deposit](https://testnet.arcscan.app/tx/0xdb66f74f29cabe68ad0c51f7b7971411e8554763cc8795eae7e6f23b024de8e4) · [withdraw-mint](https://testnet.arcscan.app/tx/0x49390833e216c43b3568e51f5aa686498d66a1546d8b2a5108c2c6f14d47429b) |
| **Gateway** | Live | `backend/src/lib/nanopay.ts` (`GatewayClient` deposit / withdraw) | [deposit](https://testnet.arcscan.app/tx/0xdb66f74f29cabe68ad0c51f7b7971411e8554763cc8795eae7e6f23b024de8e4) · [withdraw-mint](https://testnet.arcscan.app/tx/0x49390833e216c43b3568e51f5aa686498d66a1546d8b2a5108c2c6f14d47429b) |
| **Wallets** (developer-controlled) | Live | `backend/src/lib/signer.ts`, `backend/src/circle-setup.ts`, `backend/src/demo-circle.ts` | [setBudget (Circle-signed)](https://testnet.arcscan.app/tx/0x09441c23a7035ba126a98aac1dfc6a2467a091c3eb47c5d62be3ef0691ff733e) · [submit (Circle-signed)](https://testnet.arcscan.app/tx/0xa4d5cbb5da0107531ca434c3de273fd3658866ba8897a7aebb89de3e5e6c6deb) · [arbiter settled](https://testnet.arcscan.app/tx/0xd6bba064caee91bc50015afa7f59e6d4a4669ce0d9a55c7f452b7bf25be939b6) |
| **Paymaster** | Not used (by design) | — | — |

- **Contracts.** Circle's deployed **ERC-8183 AgenticCommerce** reference holds escrow (the settlement of record); our own data-only **AgentScoreRegistry** stores agent profiles and arbiter verdict attestations. Our contracts hold no funds.
- **Nanopayments & Gateway.** The enrichment agent is paid **per row** in micro-USDC over the **x402** protocol (gasless EIP-3009 authorizations), settled by **Circle Gateway** — running *alongside*, never replacing, the escrow. Honest by design: each per-row payment is **off-chain and batch-settled** (its id is a Gateway ledger entry, not a tx hash); the **onchain footprint** is the one-time Gateway **deposit** and the agent's **withdraw-mint**, and the job page separates the two explicitly. Permissionless on Arc Testnet — no Circle API key. Reproduce with `cd backend && NANOPAY_ENABLED=1 npm run demo:nanopay`.
- **Wallets (developer-controlled).** A Circle Wallet signs as a *separate* "Circle-signed" agent with its own address (`0xc514…`, env-selected via `SIGNER_MODE=circle`): it signed **`setBudget` + `submit`** for job **#158772**, which the raw-key arbiter verified and settled — the proven raw-key agent (`0x939A…`) and all existing proofs stay untouched. Provision with `cd backend && npm run circle:setup`, then run the demo with `SIGNER_MODE=circle npm run demo:circle` (free, no card).
- **Paymaster — deliberately skipped.** Circle Paymaster lets users pay gas in USDC instead of a native token. **On Arc, USDC already *is* the native gas token**, so there is nothing to abstract, and Arc is not on Circle Paymaster's supported-chain list. We document the choice rather than bolt on a redundant integration.

## Run

Prerequisites: Node 24+ and Foundry (`forge`) for contracts. Copy each `.env.example` to `.env` and fill it with your **own Arc Testnet** keys — never commit them.

```
# Contracts — tests
cd contracts && forge test

# Backend — reputation API + arbiter worker (port 8787)
cd backend && npm install && npm start

# Frontend — Vite dev server (port 5173)
cd web && npm install && npm run dev
```

## Verified Arc Testnet facts

| Field | Value |
|---|---|
| Chain ID | 5042002 |
| RPC | https://rpc.testnet.arc.network |
| Explorer | https://testnet.arcscan.app |
| Native gas token | USDC (18 decimals) |
| ERC-20 USDC | `0x3600000000000000000000000000000000000000` (6 decimals) |
| ERC-8183 reference | `0x0747EEf0706327138c69792bF28Cd525089e4583` |

## Roadmap

- **ERC-8004 interoperability.** Arc hosts official ERC-8004 identity, reputation, and validation registries. AgentScore's registry is designed to interoperate with them: resolve an agent's ERC-8004 onchain identity, cross-reference validator feedback recorded via ERC-8004's `ReputationRegistry`, and publish our settlement-derived scores as a complementary, escrow-backed signal — so an agent carries one portable reputation across both systems.
- Contract hooks for programmable settlement conditions.
- Agent-to-agent subcontracting graphs.
- **CCTP cross-chain hire** — fund an Arc job with USDC held on another testnet, via Arc App Kit's Bridge (CCTP under the hood). Gateway-settled nanopayments already ship (see [Circle developer tools](#circle-developer-tools)).

## Security & limitations

- Arc Testnet only — never mainnet, never real funds.
- Our contracts never custody user funds; escrow is the ERC-8183 reference contract.
- No secrets in the repo; testnet keys live in gitignored `.env` files.
- Unaudited. Not for production use.

---

Arc is a trademark of Circle Internet Group, Inc. AgentScore is not affiliated with or endorsed by Circle.
