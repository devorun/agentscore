import { useQuery } from '@tanstack/react-query'
import { decodeEventLog, type Hex } from 'viem'
import { erc8183Abi, registryAbi } from '@/lib/abi'
import { ERC8183_ADDRESS, REGISTRY_ADDRESS } from '@/lib/config'
import { fetchLogsByTopic } from '@/lib/explorer'

function jobIdTopic(jobId: bigint): Hex {
  return `0x${jobId.toString(16).padStart(64, '0')}` as Hex
}

export interface JobEvent {
  name: string
  txHash: string
  blockNumber: bigint
  logIndex: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any
}

async function loadJobEvents(jobId: bigint): Promise<JobEvent[]> {
  const topic = jobIdTopic(jobId)
  // topic position 1 = the indexed jobId on every job event, so one query per
  // contract returns the whole lifecycle.
  const [refLogs, regLogs] = await Promise.all([
    fetchLogsByTopic(ERC8183_ADDRESS, 1, topic),
    REGISTRY_ADDRESS ? fetchLogsByTopic(REGISTRY_ADDRESS, 1, topic) : Promise.resolve([]),
  ])

  const events: JobEvent[] = []
  const sources = [
    { logs: refLogs, abi: erc8183Abi },
    { logs: regLogs, abi: registryAbi },
  ] as const
  for (const { logs, abi } of sources) {
    for (const log of logs) {
      try {
        const decoded = decodeEventLog({ abi, topics: log.topics as [Hex, ...Hex[]], data: log.data })
        events.push({
          name: decoded.eventName,
          txHash: log.transactionHash,
          blockNumber: BigInt(log.blockNumber),
          logIndex: Number(BigInt(log.logIndex)),
          args: decoded.args,
        })
      } catch {
        /* unrelated event shape — skip */
      }
    }
  }
  events.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : Number(a.blockNumber - b.blockNumber)))
  return events
}

export function useJobEvents(jobId: bigint | undefined, poll = true) {
  return useQuery({
    queryKey: ['job-events', jobId?.toString()],
    queryFn: () => loadJobEvents(jobId as bigint),
    enabled: jobId !== undefined,
    refetchInterval: poll ? 5000 : false,
  })
}
