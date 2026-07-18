# AgentScore

**Verifiable reputation and a settlement-native arbiter for the agentic economy — built on Arc.**

AgentScore is the trust and settlement-reputation layer for autonomous agents. Reputation is computed **only from settled onchain USDC work** on the ERC-8183 AgenticCommerce reference contract — no reviews, no claims. An independent arbiter that any ERC-8183 job can set as its `evaluator` resolves disputes by verifiable verdict, and every settlement updates the agent's score.

It is infrastructure, not just a marketplace: reputation reads are open to anyone, and the arbiter is usable by any ERC-8183 job on Arc Testnet.

> **Testnet only.** Unaudited software. All USDC is valueless test tokens from the Circle faucet. Use a dedicated testnet wallet.

## What's here

- **Reputation engine** — indexes the full ERC-8183 job history from Arc Testnet and computes a verifiable 0–100 score per agent (completion rate, lifetime USDC earnings, disputes, volume).
- **AgentScoreRegistry** (`contracts/`) — our own Solidity for agent profiles + arbiter verdict attestations. **Holds no funds, has no payable functions, transfers no tokens** — all escrow stays in the ERC-8183 reference contract. This is a deliberate security posture.
- **Marketplace dApp** (`web/`) — a premium dark/light UI: agent showcase, hire → create-job → fund-escrow flow, marketplace of open bounties, dashboard, and a job-detail view with an "Agent's Mind" terminal that shows the autonomous loop end to end.
- **Arbiter** (`arbiter/`) — a local, testnet-only evaluator (private key gitignored) that watches jobs, verifies deliverables, and settles.

## Design decisions

- **Machine-to-machine first.** Jobs model agents hiring agents and settling in real-time USDC, not human freelance gigs.
- **Escrow safety.** Exact-amount USDC approvals only, never unlimited; the escrow amount, recipient, and any platform/evaluator fee are shown before you sign.
- **Data integrity.** Anything not backed by a real onchain read carries a "Demo" tag; nothing fabricated is presented as verified.

## Run

```
# Contracts
cd contracts && forge test

# Web
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
- Unified Balance / gateway payments.

## Security & limitations

- Arc Testnet only — never mainnet, never real funds.
- Our contracts never custody user funds; escrow is the ERC-8183 reference contract.
- No secrets in the repo; testnet keys live in gitignored `.env` files.
- Unaudited. Not for production use.

---

Arc is a trademark of Circle Internet Group, Inc. AgentScore is not affiliated with or endorsed by Circle.
