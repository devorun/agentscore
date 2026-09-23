import { useQuery } from '@tanstack/react-query'
import { type Address, getAddress, keccak256, parseUnits, toHex } from 'viem'
import { publicClient, readChunked } from '../lib/client'
import { appealsAbi, erc8183Abi, registryAbi } from '../lib/abi'
import { APPEALS_ADDRESS, API_URL, ERC8183_ADDRESS, JobStatus, REGISTRY_ADDRESS, USDC_DECIMALS, type JobStatusValue } from '../lib/config'
import { apiAgent, STATUS_INDEX, txHashFromUrl } from '../lib/api'
import { fetchIndexedHead, fetchLogsByTopic, padAddressTopic, type ExplorerLog } from '../lib/explorer'
import { type AgentMetrics, deriveReputation, type JobFact, type ScoreBreakdown, type SettlementFact } from '@shared/score'

const JOB_CREATED_TOPIC = keccak256(toHex('JobCreated(uint256,address,address,address,uint256,address)'))
const PAYMENT_RELEASED_TOPIC = keccak256(toHex('PaymentReleased(uint256,address,uint256)'))
const JOB_REJECTED_TOPIC = keccak256(toHex('JobRejected(uint256,address,bytes32)'))

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

const isEvent = (log: ExplorerLog, topic: string) => log.topics[0]?.toLowerCase() === topic.toLowerCase()
const settlementOf = (log: ExplorerLog, amount6?: bigint): SettlementFact => ({
  jobId: BigInt(log.topics[1] as string),
  block: BigInt(log.blockNumber),
  timestamp: Number(BigInt(log.timeStamp)),
  amount6,
})

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
      // An API build from before time decay lacks the decay breakdown — score
      // in the browser instead (same shared module) rather than show half of it.
      if (!api.breakdown?.undecayed) throw new Error('API predates time decay')
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

/** JobRejected indexes the rejector, not the provider: look each rejection up
 * under the job's evaluator, then under its client (mirrors the API). */
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

async function loadAgentDataFromChain(address: Address): Promise<AgentData> {
  const topic = padAddressTopic(address)

  // The reference block every age is measured against: the newest block the
  // log index covers (mirrors the API), so a score never claims a block whose
  // settlements the explorer has not indexed yet.
  const [chainHead, indexed] = await Promise.all([publicClient.getBlockNumber(), fetchIndexedHead()])
  const head = await publicClient.getBlock({ blockNumber: indexed < chainHead ? indexed : chainHead })
  const ref = { block: head.number, timestamp: Number(head.timestamp) }

  // Jobs where this address is the provider (JobCreated topic3 = provider).
  const createdLogs = (await fetchLogsByTopic(ERC8183_ADDRESS, 3, topic)).filter(
    (log) => isEvent(log, JOB_CREATED_TOPIC) && BigInt(log.blockNumber) <= ref.block,
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
  const facts: JobFact[] = []
  scoped.forEach((log, i) => {
    const job = jobStates[i]
    if (!job) return
    const createdAt = Number(BigInt(log.timeStamp))
    jobs.push({
      jobId: jobIds[i],
      status: job.status as JobStatusValue,
      budget6: job.budget,
      client: job.client,
      evaluator: job.evaluator,
      description: job.description,
      expiredAt: job.expiredAt,
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

  // Settlement times: PaymentReleased where provider = address (topic2), which
  // also gives exact lifetime earnings; JobRejected is looked up per rejector.
  const payments = (await fetchLogsByTopic(ERC8183_ADDRESS, 2, topic))
    .filter((log) => isEvent(log, PAYMENT_RELEASED_TOPIC))
    .map((log) => settlementOf(log, decodeAmount(log.data)))
  const rejections = await fetchRejections(jobs.filter((j) => j.status === JobStatus.Rejected))

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

  // Same derivation as the API: the shared module turns these facts into the
  // score as of the reference block (collateral mirror jobs excluded there).
  const { breakdown, metrics, overturnedRejections } = deriveReputation(
    { jobs: facts, payments, rejections, overturned: overturnedSet },
    ref,
  )

  const profile = await loadRegistryProfile(address)
  const verdicts = await loadVerdicts(address)

  return { address, metrics, breakdown, overturnedRejections, jobs, truncated, profile, verdicts }
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
