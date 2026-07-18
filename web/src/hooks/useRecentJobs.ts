import { useQuery } from '@tanstack/react-query'
import { type Address, parseAbiItem } from 'viem'
import { publicClient, readChunked } from '@/lib/client'
import { erc8183Abi } from '@/lib/abi'
import { ERC8183_ADDRESS, GETLOGS_MAX_RANGE, type JobStatusValue } from '@/lib/config'

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
