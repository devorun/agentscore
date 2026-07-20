import { formatUnits } from 'viem'
import { USDC_DECIMALS } from './config'

// Scoring formula (identical to the backend and the on-site methodology):
//   start at 50
//   +8 per approved settlement for the first 10, +2 for each one after,
//     each weighted by CLIENT DIVERSITY: the k-th settlement from the same
//     client counts fully for k ≤ 3, then at 3/k — so N jobs from one client
//     are worth materially less than N jobs from N clients (self-farming
//     decays instead of compounding)
//   −20 per rejected verdict (never diversity-discounted — failures cannot
//     be laundered)
//   −10 per expired-unfunded abandonment where the agent was provider
//   +volume bonus: min(10, 2.5 × log10(1 + diversity-weighted USDC settled))
//   clamp to 0–100
// Collateral mirror jobs ([COLLATERAL]) are excluded upstream — they are an
// escrow mechanism, not work.

export interface AgentMetrics {
  totalJobs: number
  completed: number
  rejected: number
  expired: number
  /** Expired with no budget ever set — treated as provider abandonment. */
  expiredUnfunded: number
  /** Sum of budgets of settled jobs, ERC-20 USDC 6 decimals. */
  settled6: bigint
  /** Exact lifetime earnings from PaymentReleased events, 6 decimals. */
  earnings6: bigint
}

/** One approved settlement, in ascending jobId order, for diversity weighting. */
export interface CompletionRef {
  client: string
  budget6: bigint
}

export interface ScoreBreakdown {
  score: number
  base: number
  approvalPoints: number
  rejectionPoints: number
  abandonmentPoints: number
  volumeBonus: number
  distinctClients: number
}

/** The k-th settlement from the same client: full weight up to 3, then 3/k. */
export function clientWeight(k: number): number {
  return k <= 3 ? 1 : 3 / k
}

export function computeScore(metrics: AgentMetrics, completions: CompletionRef[]): ScoreBreakdown {
  const base = 50
  const perClient = new Map<string, number>()
  let approvalPoints = 0
  let weightedSettledUsdc = 0
  completions.forEach((c, i) => {
    const key = c.client.toLowerCase()
    const k = (perClient.get(key) ?? 0) + 1
    perClient.set(key, k)
    const w = clientWeight(k)
    const rate = i < 10 ? 8 : 2 // global diminishing after the 10th settlement
    approvalPoints += rate * w
    weightedSettledUsdc += Number(formatUnits(c.budget6, USDC_DECIMALS)) * w
  })
  approvalPoints = Math.round(approvalPoints * 100) / 100
  const rejectionPoints = -20 * metrics.rejected
  const abandonmentPoints = -10 * metrics.expiredUnfunded
  const volumeBonus = Math.min(10, 2.5 * Math.log10(1 + weightedSettledUsdc))

  const raw = base + approvalPoints + rejectionPoints + abandonmentPoints + volumeBonus
  const score = Math.round(Math.min(100, Math.max(0, raw)))
  return { score, base, approvalPoints, rejectionPoints, abandonmentPoints, volumeBonus, distinctClients: perClient.size }
}

/** Completion rate over jobs that reached a terminal state. */
export function completionRate(metrics: AgentMetrics): number | null {
  const terminal = metrics.completed + metrics.rejected + metrics.expired
  if (terminal === 0) return null
  return metrics.completed / terminal
}
