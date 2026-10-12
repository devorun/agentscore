// hono/quick: a router with no build step — the default compiles its route
// table on the first request, CPU a cold Worker pays on every invocation.
import { Hono } from 'hono/quick'
import { cors } from 'hono/cors'
import { formatUnits, getAddress, isAddress, keccak256, toHex, type Hex } from 'viem'
import { publicClient } from './lib/chain.js'
import { erc8183Abi } from './lib/abi.js'
import { API_ONLY, ARBITER_ADDRESS, ERC8183_ADDRESS, EXPLORER_URL, REGISTRY_ADDRESS, USDC_DECIMALS } from './lib/config.js'
import { AGENTS } from './lib/agents.js'
import { creditTerms } from './lib/credit.js'
import { computeReputation } from './lib/reputation.js'
import { recentJobs } from './lib/jobs.js'
import { arbiterVerdicts } from './lib/verdicts.js'
import { fetchChainLogs, fetchIndexedHead, fetchLogsByTopic, type ExplorerLog } from './lib/explorer.js'
import { agentCard, cardUrl, feedbackFileJson, IDENTITY_REGISTRY, identityTokenUrl, profileOf, REPUTATION_REGISTRY } from './lib/erc8004.js'

const usdc = (v: bigint) => formatUnits(v, USDC_DECIMALS)
const tx = (h: string) => `${EXPLORER_URL}/tx/${h}`
const STATUS = ['open', 'funded', 'submitted', 'completed', 'rejected', 'expired']

export const app = new Hono()
app.use('*', cors())

app.get('/', (c) =>
  c.json({
    service: 'agentscore-backend',
    description: 'Reputation + settlement API for the agentic economy, built on Arc.',
    endpoints: ['/health', '/agents', '/agent/:address', '/agent/:address/card.json', '/jobs', '/arbiter/verdicts', '/erc8004/feedback/:jobId'],
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
      coverage: r.coverage,
      erc8004: erc8004Of(r.address),
    })
  } catch (e) {
    return c.json({ error: 'invalid address or read failed', detail: String(e).slice(0, 160) }, 400)
  }
})

/** ERC-8004 identity of one of our agents, or null for any other address. */
function erc8004Of(address: string) {
  const p = profileOf(address)
  if (!p || p.erc8004Id === undefined) return null
  return { agentId: p.erc8004Id, identityRegistry: IDENTITY_REGISTRY, reputationRegistry: REPUTATION_REGISTRY, card: cardUrl(p.address), explorer: identityTokenUrl(p.erc8004Id) }
}

// ERC-8004 agent registration file — the URI each agent registered in the
// official Identity Registry (and as its AgentScoreRegistry metadataURI).
app.get('/agent/:address/card.json', (c) => {
  const a = c.req.param('address')
  const p = isAddress(a) ? profileOf(a) : undefined
  if (!p) return c.json({ error: 'not an AgentScore-registered agent' }, 404)
  return c.json(agentCard(p))
})

const JOB_COMPLETED = keccak256(toHex('JobCompleted(uint256,address,bytes32)'))
const JOB_REJECTED = keccak256(toHex('JobRejected(uint256,address,bytes32)'))
const SETTLED_TOPICS = new Set<string>([JOB_COMPLETED, JOB_REJECTED])

// The off-chain feedback file behind each verdict the arbiter posted to the
// ERC-8004 Reputation Registry. Rebuilt from chain, byte-identical to what the
// arbiter hashed, so keccak256(body) equals the feedbackHash stored onchain.
app.get('/erc8004/feedback/:jobId', async (c) => {
  const id = c.req.param('jobId')
  if (!/^\d+$/.test(id)) return c.json({ error: 'jobId must be a number' }, 400)
  try {
    const jobId = BigInt(id)
    const job = await publicClient.readContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'getJob', args: [jobId] })
    const p = profileOf(job.provider)
    if (!p || p.erc8004Id === undefined || getAddress(job.evaluator) !== ARBITER_ADDRESS) return c.json({ error: 'not an AgentScore-arbitrated job of a registered agent' }, 404)
    const jobTopic = `0x${jobId.toString(16).padStart(64, '0')}` as Hex
    const isSettlement = (l: ExplorerLog) => SETTLED_TOPICS.has(l.topics[0]?.toLowerCase()) && l.topics[1]?.toLowerCase() === jobTopic
    let log = (await fetchLogsByTopic(ERC8183_ADDRESS, 1, jobTopic)).find(isSettlement)
    if (!log) {
      // Past the explorer's index: read the gap from chain.
      const [indexed, tip] = await Promise.all([fetchIndexedHead(), publicClient.getBlockNumber()])
      if (indexed < tip) {
        const gap = await fetchChainLogs(indexed, tip, { address: [ERC8183_ADDRESS], topics: [[JOB_COMPLETED, JOB_REJECTED], jobTopic] })
        log = gap.logs.find(isSettlement)
      }
    }
    if (!log) return c.json({ error: 'job not settled yet' }, 404)
    const body = feedbackFileJson({
      agentId: p.erc8004Id,
      jobId,
      completed: log.topics[0].toLowerCase() === JOB_COMPLETED,
      reason: log.data.slice(0, 66) as Hex,
      arbiter: ARBITER_ADDRESS,
      settledAt: Number(BigInt(log.timeStamp)),
    })
    return c.body(body, 200, { 'content-type': 'application/json', 'x-feedback-hash': keccak256(toHex(body)) })
  } catch (e) {
    return c.json({ error: String(e).slice(0, 160) }, 503)
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
