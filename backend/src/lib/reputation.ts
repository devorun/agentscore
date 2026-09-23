import { getAddress, keccak256, toHex, type Address, type Hex } from 'viem'
import { ERC8183_ADDRESS, JobStatus, READ_RPCS, type JobStatusValue } from './config.js'
import { fetchChainLogs, fetchIndexedHead, fetchLogsByTopic, mergeLogs, padAddressTopic, type ExplorerLog } from './explorer.js'
import { fetchOverturnedRejections } from './appeal.js'
import { aggregate3, decodeJob, getJobCall, rpc } from './lean.js'
import {
  completionRate,
  deriveReputation,
  type AgentMetrics,
  type JobFact,
  type ReferenceBlock,
  type ScoreBreakdown,
  type SettlementFact,
} from './score.js'

// Reads run on the lean path (lib/lean.ts): this is the API's hot path on the
// Workers free plan, where viem's client and ABI codec alone overran the CPU
// budget. The explorer serves deep history; anything it has not indexed yet is
// read straight from chain (fetchChainLogs), so scores reach the chain tip.
const JOB_CREATED_TOPIC = keccak256(toHex('JobCreated(uint256,address,address,address,uint256,address)'))
const PAYMENT_RELEASED_TOPIC = keccak256(toHex('PaymentReleased(uint256,address,uint256)'))
const JOB_REJECTED_TOPIC = keccak256(toHex('JobRejected(uint256,address,bytes32)'))
const MAX_JOBS = 200

export interface JobRow {
  jobId: bigint
  status: JobStatusValue
  budget6: bigint
  client: Address
  evaluator: Address
  description: string
  createdAt: number
  createdTx: string
}

export interface AgentReputation {
  address: Address
  score: number
  breakdown: ScoreBreakdown
  metrics: AgentMetrics
  completionRate: number | null
  /** Rejections overturned by a second-arbiter appeal — no longer penalized. */
  overturnedRejections: number
  jobs: JobRow[]
  truncated: boolean
}

export interface ReputationOptions {
  /** Reference block every age is measured against. Default: the chain tip
   * (or the last block history could be read to, if the backfill fell short). */
  block?: bigint
  /** Score the agent as it stood when this job was created (the credit-terms
   * gate): the reference becomes the job's creation block. */
  atJob?: bigint
}

const isEvent = (l: ExplorerLog, topic: string) => l.topics[0]?.toLowerCase() === topic.toLowerCase()
const settlementOf = (l: ExplorerLog, amount6?: bigint): SettlementFact => ({
  jobId: BigInt(l.topics[1] as string),
  block: BigInt(l.blockNumber),
  timestamp: Number(BigInt(l.timeStamp)),
  amount6,
})

/** How far onchain history is readable right now: the explorer's index, plus
 * whatever the chain backfill reads beyond it. `covered` is the last block
 * whose logs are all in hand — the chain tip unless a backfill page failed. */
async function history(): Promise<{ covered: bigint; gapLogs: ExplorerLog[] }> {
  const [tipHex, indexed] = await Promise.all([rpc<Hex>(READ_RPCS, 'eth_blockNumber', []), fetchIndexedHead()])
  const tip = BigInt(tipHex)
  if (indexed >= tip) return { covered: tip, gapLogs: [] }
  const { logs, upTo } = await fetchChainLogs(indexed, tip)
  return { covered: upTo, gapLogs: logs }
}

async function blockTimestamp(block: bigint): Promise<number> {
  const b = await rpc<{ timestamp: Hex } | null>(READ_RPCS, 'eth_getBlockByNumber', [`0x${block.toString(16)}`, false])
  if (!b) throw new Error(`block ${block} not found`)
  return Number(BigInt(b.timestamp))
}

/** JobRejected indexes the rejector, not the provider: look each rejection up
 * in the backfilled logs, then under the job's evaluator (who rejects submitted
 * work), then under its client (who may reject its own job while still Open). */
async function fetchRejections(rejected: JobRow[], gapLogs: ExplorerLog[]): Promise<SettlementFact[]> {
  const found = new Map<string, SettlementFact>()
  const wantedIds = new Set(rejected.map((j) => j.jobId.toString()))
  for (const log of gapLogs) {
    const s = isEvent(log, JOB_REJECTED_TOPIC) ? settlementOf(log) : undefined
    if (s && wantedIds.has(s.jobId.toString())) found.set(s.jobId.toString(), s)
  }
  for (const party of ['evaluator', 'client'] as const) {
    const pending = rejected.filter((j) => !found.has(j.jobId.toString()))
    const wanted = new Set(pending.map((j) => j.jobId.toString()))
    for (const who of new Set(pending.map((j) => padAddressTopic(j[party])))) {
      for (const log of await fetchLogsByTopic(ERC8183_ADDRESS, 2, who)) {
        const s = settlementOf(log)
        if (isEvent(log, JOB_REJECTED_TOPIC) && wanted.has(s.jobId.toString())) found.set(s.jobId.toString(), s)
      }
    }
  }
  return [...found.values()]
}

export async function computeReputation(rawAddress: string, opts: ReputationOptions = {}): Promise<AgentReputation> {
  const address = getAddress(rawAddress)
  const topic = padAddressTopic(address)
  const topicLc = topic.toLowerCase()

  const [indexedCreated, { covered, gapLogs }] = await Promise.all([fetchLogsByTopic(ERC8183_ADDRESS, 3, topic), history()])
  const createdLogs = mergeLogs(indexedCreated, gapLogs.filter((l) => l.topics[3]?.toLowerCase() === topicLc)).filter((l) =>
    isEvent(l, JOB_CREATED_TOPIC),
  )

  // The reference block: the hired job's creation block for the terms gate,
  // an explicit block, or the last block history is fully readable to (the
  // chain tip unless the backfill fell short) — never a block whose logs are
  // not all in hand, so "computed at block N" is reproducible.
  const hireLog = opts.atJob === undefined ? undefined : createdLogs.find((l) => BigInt(l.topics[1] as string) === opts.atJob)
  let ref: ReferenceBlock
  if (hireLog) {
    ref = { block: BigInt(hireLog.blockNumber), timestamp: Number(BigInt(hireLog.timeStamp)) }
  } else {
    if (opts.block !== undefined && opts.block > covered) {
      throw new Error(`block ${opts.block} is past readable history (logs are in hand up to ${covered})`)
    }
    const block = opts.block ?? covered
    ref = { block, timestamp: await blockTimestamp(block) }
  }

  createdLogs.sort((a, b) => (BigInt(a.blockNumber) < BigInt(b.blockNumber) ? -1 : 1))
  const inScope = createdLogs.filter((l) => BigInt(l.blockNumber) <= ref.block)
  const truncated = inScope.length > MAX_JOBS
  const scoped = inScope.slice(-MAX_JOBS)
  const jobIds = scoped.map((l) => BigInt(l.topics[1] as string))

  const states = (await aggregate3(READ_RPCS, jobIds.map((jobId) => ({ target: ERC8183_ADDRESS, callData: getJobCall(jobId) })))).map(decodeJob)

  const jobs: JobRow[] = []
  const facts: JobFact[] = []
  scoped.forEach((log, i) => {
    const job = states[i]
    if (!job) return
    const createdAt = Number(BigInt(log.timeStamp))
    jobs.push({
      jobId: jobIds[i],
      status: job.status as JobStatusValue,
      budget6: job.budget,
      client: job.client,
      evaluator: job.evaluator,
      description: job.description,
      createdAt,
      createdTx: log.transactionHash,
    })
    facts.push({
      jobId: jobIds[i],
      client: job.client,
      budget6: job.budget,
      description: job.description,
      status: job.status,
      createdBlock: BigInt(log.blockNumber),
      createdAt,
      expiredAt: Number(job.expiredAt),
    })
  })
  jobs.sort((a, b) => Number(b.jobId - a.jobId))

  // Settlement times: PaymentReleased indexes the provider (one query, which
  // also gives exact lifetime earnings); JobRejected is looked up per rejector.
  const indexedPayments = await fetchLogsByTopic(ERC8183_ADDRESS, 2, topic)
  const payments = mergeLogs(indexedPayments, gapLogs.filter((l) => l.topics[2]?.toLowerCase() === topicLc))
    .filter((l) => isEvent(l, PAYMENT_RELEASED_TOPIC))
    .map((l) => settlementOf(l, BigInt(l.data.slice(0, 66))))
  const rejections = await fetchRejections(
    jobs.filter((j) => j.status === JobStatus.Rejected),
    gapLogs,
  )

  // Rejections this agent had overturned by a second-arbiter appeal — recorded
  // onchain in AgentScoreAppeals. A failed read yields an empty set, so scoring
  // falls back exactly to counting every rejection.
  const overturned = await fetchOverturnedRejections(address, ref.block, gapLogs)

  const { breakdown, metrics, overturnedRejections } = deriveReputation({ jobs: facts, payments, rejections, overturned }, ref)
  return { address, score: breakdown.score, breakdown, metrics, completionRate: completionRate(metrics), overturnedRejections, jobs, truncated }
}
