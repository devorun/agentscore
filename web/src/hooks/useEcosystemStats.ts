import { useQuery } from '@tanstack/react-query'
import { parseAbiItem } from 'viem'
import { publicClient } from '../lib/client'
import { erc8183Abi, registryAbi } from '../lib/abi'
import { ERC8183_ADDRESS, GETLOGS_MAX_RANGE, REGISTRY_ADDRESS } from '../lib/config'

const paymentReleasedEvent = parseAbiItem(
  'event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount)',
)

export interface EcosystemStats {
  jobsIndexed: bigint
  agentsRegistered: bigint
  /** USDC settled (6 decimals) within the recent indexed window. */
  settledRecent6: bigint
  /** Block span the settled figure was computed over. */
  windowBlocks: bigint
  lastIndexedBlock: bigint
}

async function loadEcosystemStats(): Promise<EcosystemStats> {
  const head = await publicClient.getBlockNumber()

  const jobsIndexed = await publicClient.readContract({
    address: ERC8183_ADDRESS,
    abi: erc8183Abi,
    functionName: 'jobCounter',
  })

  let agentsRegistered = 0n
  if (REGISTRY_ADDRESS) {
    try {
      agentsRegistered = await publicClient.readContract({
        address: REGISTRY_ADDRESS,
        abi: registryAbi,
        functionName: 'agentCount',
      })
    } catch {
      agentsRegistered = 0n
    }
  }

  // Settled USDC over the last window (one getLogs call within the RPC's range cap).
  const fromBlock = head > GETLOGS_MAX_RANGE ? head - GETLOGS_MAX_RANGE + 1n : 0n
  const paymentLogs = await publicClient.getLogs({
    address: ERC8183_ADDRESS,
    event: paymentReleasedEvent,
    fromBlock,
    toBlock: head,
  })
  const settledRecent6 = paymentLogs.reduce((sum, log) => sum + (log.args.amount ?? 0n), 0n)

  return {
    jobsIndexed,
    agentsRegistered,
    settledRecent6,
    windowBlocks: head - fromBlock + 1n,
    lastIndexedBlock: head,
  }
}

export function useEcosystemStats() {
  return useQuery({
    queryKey: ['ecosystem-stats'],
    queryFn: loadEcosystemStats,
    staleTime: 30_000,
  })
}
