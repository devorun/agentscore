import { decodeEventLog, type Address, type Hex } from 'viem'
import { registryAbi } from './abi.js'
import { ARBITER_ADDRESS, REGISTRY_ADDRESS } from './config.js'
import { fetchLogsByTopic, padAddressTopic } from './explorer.js'

export interface Verdict {
  jobId: bigint
  agent: Address
  outcome: number // 0 = Approved, 1 = Rejected
  reasonHash: string
  arbiter: Address
  txHash: string
}

// VerdictAttested(jobId indexed, agent indexed, outcome, reasonHash, arbiter indexed)
// topic3 = arbiter, so this returns every verdict our arbiter has attested.
export async function arbiterVerdicts(): Promise<Verdict[]> {
  const logs = await fetchLogsByTopic(REGISTRY_ADDRESS, 3, padAddressTopic(ARBITER_ADDRESS))
  const verdicts: Verdict[] = []
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: registryAbi, topics: log.topics as [Hex, ...Hex[]], data: log.data })
      if (decoded.eventName !== 'VerdictAttested') continue
      const a = decoded.args as { jobId: bigint; agent: Address; outcome: number; reasonHash: string; arbiter: Address }
      verdicts.push({
        jobId: a.jobId,
        agent: a.agent,
        outcome: Number(a.outcome),
        reasonHash: a.reasonHash,
        arbiter: a.arbiter,
        txHash: log.transactionHash,
      })
    } catch {
      /* unrelated log shape */
    }
  }
  verdicts.sort((x, y) => Number(y.jobId - x.jobId))
  return verdicts
}
