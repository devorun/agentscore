import { getAddress, keccak256, toHex, type Address } from 'viem'
import { publicClient } from './chain.js'
import { erc8183Abi } from './abi.js'
import { ERC8183_ADDRESS, JobStatus, type JobStatusValue } from './config.js'
import { fetchLogsByTopic, padAddressTopic, type ExplorerLog } from './explorer.js'
import { fetchOverturnedRejections } from './appeal.js'
import {
  completionRate,
  deriveReputation,
  type AgentMetrics,
  type JobFact,
  type ReferenceBlock,
  type ScoreBreakdown,
  type SettlementFact,
} from './score.js'

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
  /** Reference block every age is measured against. Default: the chain head. */
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

async function blockAt(blockNumber?: bigint): Promise<ReferenceBlock> {
  const b = blockNumber === undefined ? await publicClient.getBlock() : await publicClient.getBlock({ blockNumber })
  return { block: b.number, timestamp: Number(b.timestamp) }
}

/** JobRejected indexes the rejector, not the provider: look each rejection up
 * under the job's evaluator (who rejects submitted work), then under its client
 * (who may reject its own job while it is still Open). */
async function fetchRejections(rejected: JobRow[]): Promise<SettlementFact[]> {
  const found = new Map<string, SettlementFact>()
  for (const party of ['evaluator', 'client'] as const) {
    const pending = rejected.filter((j) => !found.has(j.jobId.toString()))
    const wanted = new Set(pending.map((j) => j.jobId.toString()))
    for (const who of new Set(pending.map((j) => getAddress(j[party])))) {
      for (const log of await fetchLogsByTopic(ERC8183_ADDRESS, 2, padAddressTopic(who))) {
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

  const createdLogs = (await fetchLogsByTopic(ERC8183_ADDRESS, 3, topic)).filter((l) => isEvent(l, JOB_CREATED_TOPIC))

  // The reference block: the hired job's creation block for the terms gate
  // (falls back to the head while the explorer is still indexing a brand-new
  // job), an explicit block, or the chain head.
  const hireLog = opts.atJob === undefined ? undefined : createdLogs.find((l) => BigInt(l.topics[1] as string) === opts.atJob)
  const ref: ReferenceBlock = hireLog
    ? { block: BigInt(hireLog.blockNumber), timestamp: Number(BigInt(hireLog.timeStamp)) }
    : await blockAt(opts.block)

  const inScope = createdLogs.filter((l) => BigInt(l.blockNumber) <= ref.block)
  const truncated = inScope.length > MAX_JOBS
  const scoped = inScope.slice(-MAX_JOBS)
  const jobIds = scoped.map((l) => BigInt(l.topics[1] as string))

  const states = await publicClient.multicall({
    contracts: jobIds.map((jobId) => ({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'getJob' as const, args: [jobId] })),
    allowFailure: true,
  })

  const jobs: JobRow[] = []
  const facts: JobFact[] = []
  scoped.forEach((log, i) => {
    const state = states[i]
    if (state.status !== 'success') return
    const job = state.result as {
      client: Address
      evaluator: Address
      description: string
      budget: bigint
      expiredAt: bigint
      status: number
    }
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
  const payments = (await fetchLogsByTopic(ERC8183_ADDRESS, 2, topic))
    .filter((l) => isEvent(l, PAYMENT_RELEASED_TOPIC))
    .map((l) => settlementOf(l, BigInt(l.data.slice(0, 66))))
  const rejections = await fetchRejections(jobs.filter((j) => j.status === JobStatus.Rejected))

  // Rejections this agent had overturned by a second-arbiter appeal — recorded
  // onchain in AgentScoreAppeals. A failed read yields an empty set, so scoring
  // falls back exactly to counting every rejection.
  const overturned = await fetchOverturnedRejections(address, ref.block)

  const { breakdown, metrics, overturnedRejections } = deriveReputation({ jobs: facts, payments, rejections, overturned }, ref)
  return { address, score: breakdown.score, breakdown, metrics, completionRate: completionRate(metrics), overturnedRejections, jobs, truncated }
}
