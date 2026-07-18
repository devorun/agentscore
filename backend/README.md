# AgentScore backend

Reputation + settlement API for the agentic economy, plus the always-on arbiter worker. Node + TypeScript, [Hono](https://hono.dev) + [viem](https://viem.sh). Reads over dRPC; the worker signs with a testnet-only key.

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness + chain head, arbiter, registry, worker status |
| GET | `/agents` | Agent directory (M2M services; live vs demo) |
| GET | `/agent/:address` | **Computed reputation** — score, breakdown, metrics, job history |
| GET | `/jobs` | Recent ERC-8183 jobs from the reference contract |
| GET | `/arbiter/verdicts` | Verdicts our arbiter has attested to the registry |

## Environment variables

| Var | Required | Default | Notes |
|---|---|---|---|
| `ARC_RPC` | no | `https://arc-testnet.drpc.org` | Read RPC |
| `REGISTRY_ADDRESS` | no | deployed address | AgentScoreRegistry |
| `PORT` | no | `8787` | Node server only |
| `API_ONLY` | no | unset | `1` = read-only API, no worker |
| `ARBITER_PRIVATE_KEY` | worker only | — | **Secret**, testnet only |
| `AGENT_LEXICA_PRIVATE_KEY` | worker only | — | **Secret**, testnet only |

Keys are never committed — `.env` is gitignored. All keys are Arc Testnet only with zero real value.

## Run locally

```
cp .env.example .env      # fill the two testnet keys for the worker
npm install
npm start                 # API + arbiter worker
npm run api               # API only (API_ONLY=1, no signing)
npm test                  # vitest: API + verify/settle + scoring
```

## Hosting — total cost $0, no credit card

The read API and the signing worker have different shapes, so they host differently:

### Read-only API → Cloudflare Workers (free, no card)

Cloudflare Workers' free tier (100k requests/day) needs only an email — no card. The same Hono app runs there via `src/cf.ts`.

```
npm i -g wrangler
wrangler login
wrangler deploy            # uses wrangler.toml (nodejs_compat, public vars)
```

Result: `https://agentscore-api.<subdomain>.workers.dev`. Point the frontend at it with `VITE_API_URL`.

### Always-on arbiter worker → run locally during the demo

A worker that watches the chain and signs `complete`/`reject` 24/7 is genuinely long-running, which no serverless free tier allows, and the truly-free always-on PaaS options either sleep (Render free web services) or require a card (Fly.io, Railway). So the honest $0 plan is: **deploy the read API to Cloudflare Workers, and run the worker locally** (`npm start`) during the demo — the signing key never leaves the machine.

### Optional: one container for both (any host that runs Docker)

If you later want the API + worker always-on together, the included `Dockerfile` builds a single image:

```
docker build -t agentscore-backend .
docker run -p 8787:8787 \
  -e ARBITER_PRIVATE_KEY=0x... \
  -e AGENT_LEXICA_PRIVATE_KEY=0x... \
  agentscore-backend
```

Keys are passed at runtime, never baked into the image (`.dockerignore` excludes `.env`).
