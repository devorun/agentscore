import { useQuery } from '@tanstack/react-query'
import { type Address, parseAbiItem, parseUnits } from 'viem'
import { publicClient, readChunked } from '@/lib/client'
import { erc8183Abi } from '@/lib/abi'
import { API_URL, ERC8183_ADDRESS, GETLOGS_MAX_RANGE, USDC_DECIMALS, type JobStatusValue } from '@/lib/config'
import { apiJobs, STATUS_INDEX, txHashFromUrl } from '@/lib/api'

const jobCreatedEvent = parseAbiItem(
  'event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)',
)

export interface RecentJob {
  jobId: bigint
  client: Address
  provider: Address
  status: JobStatusValue
  budget6: bigint
  description: string
  txHash: string
}

async function loadRecentJobs(): Promise<RecentJob[]> {
  if (API_URL) {
    try {
      const { jobs } = await apiJobs()
      return jobs.map((j) => ({
        jobId: BigInt(j.jobId),
        client: j.client,
        provider: j.provider,
        status: (STATUS_INDEX[j.status] ?? 0) as JobStatusValue,
        budget6: parseUnits(j.budgetUsdc, USDC_DECIMALS),
        description: j.description,
        txHash: txHashFromUrl(j.tx),
      }))
    } catch {
      // API down — fall through to direct chain reads.
    }
  }
  return loadRecentJobsFromChain()
}

async function loadRecentJobsFromChain(): Promise<RecentJob[]> {
  const head = await publicClient.getBlockNumber()
  const fromBlock = head > GETLOGS_MAX_RANGE ? head - GETLOGS_MAX_RANGE + 1n : 0n
  const logs = await publicClient.getLogs({
    address: ERC8183_ADDRESS,
    event: jobCreatedEvent,
    fromBlock,
    toBlock: head,
  })
  const recent = logs.slice(-12).reverse()
  if (recent.length === 0) return []

  const states = await readChunked<{
    client: Address
    provider: Address
    description: string
    budget: bigint
    status: number
  }>(
    recent.map((log) => ({
      address: ERC8183_ADDRESS,
      abi: erc8183Abi,
      functionName: 'getJob',
      args: [log.args.jobId!],
    })),
  )

  const out: RecentJob[] = []
  recent.forEach((log, i) => {
    const s = states[i]
    if (!s) return
    out.push({
      jobId: log.args.jobId!,
      client: s.client,
      provider: s.provider,
      status: s.status as JobStatusValue,
      budget6: s.budget,
      description: s.description,
      txHash: log.transactionHash,
    })
  })
  return out
}

export function useRecentJobs() {
  return useQuery({
    queryKey: ['recent-jobs'],
    queryFn: loadRecentJobs,
    staleTime: 30_000,
  })
}
