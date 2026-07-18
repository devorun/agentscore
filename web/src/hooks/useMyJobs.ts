import { useQuery } from '@tanstack/react-query'
import { type Address, keccak256, toHex } from 'viem'
import { readChunked } from '@/lib/client'
import { erc8183Abi } from '@/lib/abi'
import { ERC8183_ADDRESS, type JobStatusValue } from '@/lib/config'
import { fetchLogsByTopic, padAddressTopic } from '@/lib/explorer'

const JOB_CREATED_TOPIC = keccak256(toHex('JobCreated(uint256,address,address,address,uint256,address)'))
const MAX = 60

export interface MyJob {
  jobId: bigint
  role: 'client' | 'provider'
  status: JobStatusValue
  budget6: bigint
  counterparty: Address
  description: string
}

async function loadMyJobs(address: Address): Promise<MyJob[]> {
  const topic = padAddressTopic(address)
  // JobCreated: topic2 = client, topic3 = provider.
  const [asClient, asProvider] = await Promise.all([
    fetchLogsByTopic(ERC8183_ADDRESS, 2, topic),
    fetchLogsByTopic(ERC8183_ADDRESS, 3, topic),
  ])
  const clientIds = asClient
    .filter((l) => l.topics[0]?.toLowerCase() === JOB_CREATED_TOPIC.toLowerCase())
    .map((l) => BigInt(l.topics[1] as string))
  const providerIds = asProvider
    .filter((l) => l.topics[0]?.toLowerCase() === JOB_CREATED_TOPIC.toLowerCase())
    .map((l) => BigInt(l.topics[1] as string))

  const entries: { jobId: bigint; role: 'client' | 'provider' }[] = [
    ...clientIds.map((jobId) => ({ jobId, role: 'client' as const })),
    ...providerIds.map((jobId) => ({ jobId, role: 'provider' as const })),
  ].slice(-MAX)

  if (entries.length === 0) return []

  const states = await readChunked<{
    client: Address
    provider: Address
    description: string
    budget: bigint
    status: number
  }>(
    entries.map((e) => ({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'getJob', args: [e.jobId] })),
  )

  const out: MyJob[] = []
  entries.forEach((e, i) => {
    const s = states[i]
    if (!s) return
    out.push({
      jobId: e.jobId,
      role: e.role,
      status: s.status as JobStatusValue,
      budget6: s.budget,
      counterparty: e.role === 'client' ? s.provider : s.client,
      description: s.description,
    })
  })
  out.sort((a, b) => Number(b.jobId - a.jobId))
  return out
}

export function useMyJobs(address: Address | undefined) {
  return useQuery({
    queryKey: ['my-jobs', address],
    queryFn: () => loadMyJobs(address as Address),
    enabled: Boolean(address),
  })
}
