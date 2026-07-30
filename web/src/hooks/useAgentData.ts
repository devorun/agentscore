import { useQuery } from '@tanstack/react-query'
import { type Address, getAddress, keccak256, parseUnits, toHex } from 'viem'
import { publicClient, readChunked } from '../lib/client'
import { appealsAbi, erc8183Abi, registryAbi } from '../lib/abi'
import { APPEALS_ADDRESS, API_URL, ERC8183_ADDRESS, JobStatus, REGISTRY_ADDRESS, USDC_DECIMALS, type JobStatusValue } from '../lib/config'
import { apiAgent, STATUS_INDEX, txHashFromUrl } from '../lib/api'
import { fetchLogsByTopic, padAddressTopic } from '../lib/explorer'
import { isCollateralJob } from '../lib/credit'
import { type AgentMetrics, type CompletionRef, computeScore, type ScoreBreakdown } from '../lib/score'

const JOB_CREATED_TOPIC = keccak256(toHex('JobCreated(uint256,address,address,address,uint256,address)'))
const PAYMENT_RELEASED_TOPIC = keccak256(toHex('PaymentReleased(uint256,address,uint256)'))

// Bound work for arbitrary addresses; our demo agents sit well under this.
// Two chunks of 100 => two eth_calls, comfortably inside the RPC burst budget.
const MAX_JOBS = 200

export interface JobRow {
  jobId: bigint
  status: JobStatusValue
  budget6: bigint
  client: Address
  evaluator: Address
  description: string
  expiredAt: bigint
  createdAt: number
  createdTx: string
}

export interface RegistryProfile {
  registered: boolean
  name: string
  skillTags: string[]
  metadataURI: string
  registeredAt: number
}

export interface VerdictRow {
  jobId: bigint
  outcome: number
  reasonHash: string
  arbiter: Address
  attestedAt: number
}

export interface AgentData {
  address: Address
  metrics: AgentMetrics
  breakdown: ScoreBreakdown
  /** Rejections overturned by a second-arbiter appeal — excluded from `rejected`. */
  overturnedRejections: number
  jobs: JobRow[]
  truncated: boolean
  profile: RegistryProfile
  verdicts: VerdictRow[]
}

function decodeAmount(data: `0x${string}`): bigint {
  return BigInt(data.slice(0, 66))
}

// Prefer the backend API for the reputation core (score, metrics, job history);
// registry profile + verdicts are quick direct reads. Falls back entirely to
// chain if the API is unset or unreachable.
async function loadAgentData(address: Address): Promise<AgentData> {
  if (API_URL) {
    try {
      const [api, profile, verdicts] = await Promise.all([
        apiAgent(address),
        loadRegistryProfile(address),
        loadVerdicts(address),
      ])
      const metrics: AgentMetrics = {
        totalJobs: api.metrics.totalJobs,
        completed: api.metrics.completed,
        rejected: api.metrics.rejected,
        expired: api.metrics.expired,
        expiredUnfunded: 0,
        settled6: parseUnits(api.metrics.settledValueUsdc, USDC_DECIMALS),
        earnings6: parseUnits(api.metrics.lifetimeEarningsUsdc, USDC_DECIMALS),
      }
      const jobs: JobRow[] = api.jobs.map((j) => ({
        jobId: BigInt(j.jobId),
        status: (STATUS_INDEX[j.status] ?? 0) as JobStatusValue,
        budget6: parseUnits(j.budgetUsdc, USDC_DECIMALS),
        client: j.client,
        evaluator: j.evaluator,
        description: j.description,
        expiredAt: 0n,
        createdAt: j.createdAt,
        createdTx: txHashFromUrl(j.tx),
      }))
      return { address, metrics, breakdown: api.breakdown, overturnedRejections: api.metrics.overturnedRejections ?? 0, jobs, truncated: api.truncated, profile, verdicts }
    } catch {
      // API down — fall through to direct chain reads.
    }
  }
  return loadAgentDataFromChain(address)
}

async function loadAgentDataFromChain(address: Address): Promise<AgentData> {
  const topic = padAddressTopic(address)

  // Jobs where this address is the provider (JobCreated topic3 = provider).
  const createdLogs = (await fetchLogsByTopic(ERC8183_ADDRESS, 3, topic)).filter(
    (log) => log.topics[0]?.toLowerCase() === JOB_CREATED_TOPIC.toLowerCase(),
  )

  const truncated = createdLogs.length > MAX_JOBS
  const scoped = createdLogs.slice(-MAX_JOBS)

  const jobIds = scoped.map((log) => BigInt(log.topics[1] as string))
  const jobStates = await readChunked<{
    client: Address
    provider: Address
    evaluator: Address
    description: string
    budget: bigint
    expiredAt: bigint
    status: number
  }>(
    jobIds.map((jobId) => ({
      address: ERC8183_ADDRESS,
      abi: erc8183Abi,
      functionName: 'getJob',
      args: [jobId],
    })),
  )

  const jobs: JobRow[] = []
  scoped.forEach((log, i) => {
    const job = jobStates[i]
    if (!job) return
    jobs.push({
      jobId: jobIds[i],
      status: job.status as JobStatusValue,
      budget6: job.budget,
      client: job.client,
      evaluator: job.evaluator,
      description: job.description,
      expiredAt: job.expiredAt,
      createdAt: Number(BigInt(log.timeStamp)),
      createdTx: log.transactionHash,
    })
  })
  jobs.sort((a, b) => Number(b.jobId - a.jobId))

  // Exact lifetime earnings: PaymentReleased where provider = address (topic2).
  const paymentLogs = (await fetchLogsByTopic(ERC8183_ADDRESS, 2, topic)).filter(
    (log) => log.topics[0]?.toLowerCase() === PAYMENT_RELEASED_TOPIC.toLowerCase(),
  )
  const earnings6 = paymentLogs.reduce((sum, log) => sum + decodeAmount(log.data), 0n)

  // Rejections overturned by a second-arbiter appeal (AgentScoreAppeals) are not
  // penalized. A failed read leaves the set empty, so scoring falls back exactly.
  const rejectedIds = jobs.filter((j) => j.status === JobStatus.Rejected).map((j) => j.jobId)
  const overturnedSet = new Set<string>()
  if (APPEALS_ADDRESS && rejectedIds.length > 0) {
    try {
      const flags = await readChunked<boolean>(
        rejectedIds.map((jobId) => ({ address: APPEALS_ADDRESS, abi: appealsAbi, functionName: 'isOverturned' as const, args: [jobId] })),
      )
      rejectedIds.forEach((jobId, i) => {
        if (flags[i]) overturnedSet.add(jobId.toString())
      })
    } catch {
      /* appeals read failed — score exactly as before */
    }
  }

  let completed = 0
  let rejected = 0
  let overturnedRejections = 0
  let expired = 0
  let expiredUnfunded = 0
  let settled6 = 0n
  const completions: CompletionRef[] = []
  // Ascending jobId order for deterministic client-diversity weights; collateral
  // mirror jobs are an escrow mechanism, not work — excluded entirely.
  for (const job of [...jobs].reverse()) {
    if (isCollateralJob(job.description)) continue
    switch (job.status) {
      case JobStatus.Completed:
        completed += 1
        settled6 += job.budget6
        completions.push({ client: job.client, budget6: job.budget6 })
        break
      case JobStatus.Rejected:
        if (overturnedSet.has(job.jobId.toString())) overturnedRejections += 1
        else rejected += 1
        break
      case JobStatus.Expired:
        expired += 1
        if (job.budget6 === 0n) expiredUnfunded += 1
        break
    }
  }

  const metrics: AgentMetrics = {
    totalJobs: jobs.length,
    completed,
    rejected,
    expired,
    expiredUnfunded,
    settled6,
    earnings6,
  }

  const profile = await loadRegistryProfile(address)
  const verdicts = await loadVerdicts(address)

  return { address, metrics, breakdown: computeScore(metrics, completions), overturnedRejections, jobs, truncated, profile, verdicts }
}

async function loadRegistryProfile(address: Address): Promise<RegistryProfile> {
  const empty: RegistryProfile = { registered: false, name: '', skillTags: [], metadataURI: '', registeredAt: 0 }
  if (!REGISTRY_ADDRESS) return empty
  try {
    const result = await publicClient.readContract({
      address: REGISTRY_ADDRESS,
      abi: registryAbi,
      functionName: 'getAgent',
      args: [address],
    })
    const registeredAt = Number(result.registeredAt)
    return {
      registered: registeredAt !== 0,
      name: result.name,
      skillTags: [...result.skillTags],
      metadataURI: result.metadataURI,
      registeredAt,
    }
  } catch {
    return empty
  }
}

async function loadVerdicts(address: Address): Promise<VerdictRow[]> {
  if (!REGISTRY_ADDRESS) return []
  try {
    const result = await publicClient.readContract({
      address: REGISTRY_ADDRESS,
      abi: registryAbi,
      functionName: 'getVerdicts',
      args: [address],
    })
    return result.map((v) => ({
      jobId: v.jobId,
      outcome: v.outcome,
      reasonHash: v.reasonHash,
      arbiter: v.arbiter,
      attestedAt: Number(v.attestedAt),
    }))
  } catch {
    return []
  }
}

export function useAgentData(rawAddress: string | undefined) {
  let normalized: Address | undefined
  try {
    normalized = rawAddress ? getAddress(rawAddress) : undefined
  } catch {
    normalized = undefined
  }

  const query = useQuery({
    queryKey: ['agent', normalized],
    queryFn: () => loadAgentData(normalized as Address),
    enabled: Boolean(normalized),
  })

  return { ...query, address: normalized, isValidAddress: Boolean(normalized) }
}
