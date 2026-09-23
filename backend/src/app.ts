// hono/quick: a router with no build step — the default compiles its route
// table on the first request, CPU a cold Worker pays on every invocation.
import { Hono } from 'hono/quick'
import { cors } from 'hono/cors'
import { formatUnits } from 'viem'
import { publicClient } from './lib/chain.js'
import { erc8183Abi } from './lib/abi.js'
import { API_ONLY, ARBITER_ADDRESS, ERC8183_ADDRESS, EXPLORER_URL, REGISTRY_ADDRESS, USDC_DECIMALS } from './lib/config.js'
import { AGENTS } from './lib/agents.js'
import { creditTerms } from './lib/credit.js'
import { computeReputation } from './lib/reputation.js'
import { recentJobs } from './lib/jobs.js'
import { arbiterVerdicts } from './lib/verdicts.js'

const usdc = (v: bigint) => formatUnits(v, USDC_DECIMALS)
const tx = (h: string) => `${EXPLORER_URL}/tx/${h}`
const STATUS = ['open', 'funded', 'submitted', 'completed', 'rejected', 'expired']

export const app = new Hono()
app.use('*', cors())

app.get('/', (c) =>
  c.json({
    service: 'agentscore-backend',
    description: 'Reputation + settlement API for the agentic economy, built on Arc.',
    endpoints: ['/health', '/agents', '/agent/:address', '/jobs', '/arbiter/verdicts'],
  }),
)

app.get('/health', async (c) => {
  try {
    const [block, jobCounter] = await Promise.all([
      publicClient.getBlockNumber(),
      publicClient.readContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'jobCounter' }),
    ])
    return c.json({
      ok: true,
      service: 'agentscore-backend',
      chainId: 5042002,
      block: block.toString(),
      jobsOnReference: jobCounter.toString(),
      arbiter: ARBITER_ADDRESS,
      registry: REGISTRY_ADDRESS,
      referenceContract: ERC8183_ADDRESS,
      worker: API_ONLY ? 'disabled (API_ONLY)' : 'enabled',
    })
  } catch (e) {
    return c.json({ ok: false, error: String(e).slice(0, 160) }, 503)
  }
})

app.get('/agents', (c) => c.json({ count: AGENTS.length, agents: AGENTS }))

// ?block=N recomputes the score as it stood at block N: ages are measured
// against that block's timestamp, so the same block always gives the same score.
app.get('/agent/:address', async (c) => {
  const block = c.req.query('block')
  if (block !== undefined && !/^\d+$/.test(block)) return c.json({ error: 'block must be a block number' }, 400)
  try {
    const r = await computeReputation(c.req.param('address'), { block: block === undefined ? undefined : BigInt(block) })
    const round2 = (x: number) => Number(x.toFixed(2))
    return c.json({
      address: r.address,
      score: r.score,
      asOf: r.breakdown.asOf,
      lastActive: r.breakdown.lastActive,
      dormant: r.breakdown.dormant,
      creditTerms: creditTerms(r.score),
      breakdown: {
        ...r.breakdown,
        volumeBonus: round2(r.breakdown.volumeBonus),
        undecayed: { ...r.breakdown.undecayed, volumeBonus: round2(r.breakdown.undecayed.volumeBonus) },
      },
      completionRate: r.completionRate,
      metrics: {
        totalJobs: r.metrics.totalJobs,
        completed: r.metrics.completed,
        rejected: r.metrics.rejected,
        overturnedRejections: r.overturnedRejections,
        expired: r.metrics.expired,
        lifetimeEarningsUsdc: usdc(r.metrics.earnings6),
        settledValueUsdc: usdc(r.metrics.settled6),
      },
      jobs: r.jobs.map((j) => ({
        jobId: j.jobId.toString(),
        status: STATUS[j.status],
        budgetUsdc: usdc(j.budget6),
        client: j.client,
        evaluator: j.evaluator,
        description: j.description,
        createdAt: j.createdAt,
        tx: tx(j.createdTx),
      })),
      truncated: r.truncated,
    })
  } catch (e) {
    return c.json({ error: 'invalid address or read failed', detail: String(e).slice(0, 160) }, 400)
  }
})

app.get('/jobs', async (c) => {
  try {
    const jobs = await recentJobs(15)
    return c.json({
      count: jobs.length,
      jobs: jobs.map((j) => ({
        jobId: j.jobId.toString(),
        status: STATUS[j.status],
        budgetUsdc: usdc(j.budget6),
        client: j.client,
        provider: j.provider,
        description: j.description,
        tx: tx(j.txHash),
      })),
    })
  } catch (e) {
    return c.json({ error: String(e).slice(0, 160) }, 503)
  }
})

app.get('/arbiter/verdicts', async (c) => {
  try {
    const verdicts = await arbiterVerdicts()
    return c.json({
      arbiter: ARBITER_ADDRESS,
      registry: REGISTRY_ADDRESS,
      count: verdicts.length,
      verdicts: verdicts.map((v) => ({
        jobId: v.jobId.toString(),
        agent: v.agent,
        outcome: v.outcome === 0 ? 'approved' : 'rejected',
        reasonHash: v.reasonHash,
        tx: tx(v.txHash),
      })),
    })
  } catch (e) {
    return c.json({ error: String(e).slice(0, 160) }, 503)
  }
})
