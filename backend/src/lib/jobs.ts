import { parseAbiItem, type Address } from 'viem'
import { publicClient } from './chain.js'
import { erc8183Abi } from './abi.js'
import { ERC8183_ADDRESS, type JobStatusValue } from './config.js'

const jobCreatedEvent = parseAbiItem(
  'event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)',
)
const WINDOW = 9000n

export interface RecentJob {
  jobId: bigint
  client: Address
  provider: Address
  status: JobStatusValue
  budget6: bigint
  description: string
  txHash: string
}

export async function recentJobs(limit = 15): Promise<RecentJob[]> {
  const head = await publicClient.getBlockNumber()
  const fromBlock = head > WINDOW ? head - WINDOW : 0n
  const logs = await publicClient.getLogs({ address: ERC8183_ADDRESS, event: jobCreatedEvent, fromBlock, toBlock: head })
  const recent = logs.slice(-limit).reverse()
  if (recent.length === 0) return []

  const states = await publicClient.multicall({
    contracts: recent.map((l) => ({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'getJob' as const, args: [l.args.jobId!] })),
    allowFailure: true,
  })

  const out: RecentJob[] = []
  recent.forEach((log, i) => {
    const s = states[i]
    if (s.status !== 'success') return
    const job = s.result as { client: Address; provider: Address; description: string; budget: bigint; status: number }
    out.push({
      jobId: log.args.jobId!,
      client: job.client,
      provider: job.provider,
      status: job.status as JobStatusValue,
      budget6: job.budget,
      description: job.description,
      txHash: log.transactionHash,
    })
  })
  return out
}
