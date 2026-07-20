import { getAddress, keccak256, toHex, type Address } from 'viem'
import { publicClient } from './chain.js'
import { erc8183Abi } from './abi.js'
import { ERC8183_ADDRESS, JobStatus, type JobStatusValue } from './config.js'
import { fetchLogsByTopic, padAddressTopic } from './explorer.js'
import { isCollateralJob } from './credit.js'
import { completionRate, computeScore, type AgentMetrics, type CompletionRef, type ScoreBreakdown } from './score.js'

const JOB_CREATED_TOPIC = keccak256(toHex('JobCreated(uint256,address,address,address,uint256,address)'))
const PAYMENT_RELEASED_TOPIC = keccak256(toHex('PaymentReleased(uint256,address,uint256)'))
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
  jobs: JobRow[]
  truncated: boolean
}

export async function computeReputation(rawAddress: string): Promise<AgentReputation> {
  const address = getAddress(rawAddress)
  const topic = padAddressTopic(address)

  const createdLogs = (await fetchLogsByTopic(ERC8183_ADDRESS, 3, topic)).filter(
    (l) => l.topics[0]?.toLowerCase() === JOB_CREATED_TOPIC.toLowerCase(),
  )
  const truncated = createdLogs.length > MAX_JOBS
  const scoped = createdLogs.slice(-MAX_JOBS)
  const jobIds = scoped.map((l) => BigInt(l.topics[1] as string))

  const states = await publicClient.multicall({
    contracts: jobIds.map((jobId) => ({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'getJob' as const, args: [jobId] })),
    allowFailure: true,
  })

  const jobs: JobRow[] = []
  scoped.forEach((log, i) => {
    const state = states[i]
    if (state.status !== 'success') return
    const job = state.result as {
      client: Address
      evaluator: Address
      description: string
      budget: bigint
      status: number
    }
    jobs.push({
      jobId: jobIds[i],
      status: job.status as JobStatusValue,
      budget6: job.budget,
      client: job.client,
      evaluator: job.evaluator,
      description: job.description,
      createdAt: Number(BigInt(log.timeStamp)),
      createdTx: log.transactionHash,
    })
  })
  jobs.sort((a, b) => Number(b.jobId - a.jobId))

  const paymentLogs = (await fetchLogsByTopic(ERC8183_ADDRESS, 2, topic)).filter(
    (l) => l.topics[0]?.toLowerCase() === PAYMENT_RELEASED_TOPIC.toLowerCase(),
  )
  const earnings6 = paymentLogs.reduce((sum, l) => sum + BigInt(l.data.slice(0, 66)), 0n)

  let completed = 0
  let rejected = 0
  let expired = 0
  let expiredUnfunded = 0
  let settled6 = 0n
  const completions: CompletionRef[] = []
  // Ascending jobId order so client-diversity weights are deterministic.
  for (const job of [...jobs].reverse()) {
    // Collateral mirror jobs are an escrow mechanism, not work — they never
    // count toward (or against) anyone's reputation.
    if (isCollateralJob(job.description)) continue
    if (job.status === JobStatus.Completed) {
      completed += 1
      settled6 += job.budget6
      completions.push({ client: job.client, budget6: job.budget6 })
    } else if (job.status === JobStatus.Rejected) {
      rejected += 1
    } else if (job.status === JobStatus.Expired) {
      expired += 1
      if (job.budget6 === 0n) expiredUnfunded += 1
    }
  }

  const metrics: AgentMetrics = { totalJobs: jobs.length, completed, rejected, expired, expiredUnfunded, settled6, earnings6 }
  const breakdown = computeScore(metrics, completions)
  return { address, score: breakdown.score, breakdown, metrics, completionRate: completionRate(metrics), jobs, truncated }
}
