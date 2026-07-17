import { formatUnits } from 'viem'
import { USDC_DECIMALS } from './config'

// Scoring formula (§8 of the project brief, documented verbatim on the site):
//   start at 50
//   +8 per approved settlement for the first 10, +2 for each one after
//     ("diminishing after 10")
//   −20 per rejected verdict
//   −10 per expired-unfunded abandonment where the agent was provider
//   +volume bonus: min(10, 2.5 × log10(1 + lifetime USDC settled))
//   clamp to 0–100

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

export interface ScoreBreakdown {
  score: number
  base: number
  approvalPoints: number
  rejectionPoints: number
  abandonmentPoints: number
  volumeBonus: number
}

export function computeScore(metrics: AgentMetrics): ScoreBreakdown {
  const base = 50
  const fullRate = Math.min(metrics.completed, 10)
  const reducedRate = Math.max(0, metrics.completed - 10)
  const approvalPoints = fullRate * 8 + reducedRate * 2
  const rejectionPoints = -20 * metrics.rejected
  const abandonmentPoints = -10 * metrics.expiredUnfunded
  const settledUsdc = Number(formatUnits(metrics.settled6, USDC_DECIMALS))
  const volumeBonus = Math.min(10, 2.5 * Math.log10(1 + settledUsdc))

  const raw = base + approvalPoints + rejectionPoints + abandonmentPoints + volumeBonus
  const score = Math.round(Math.min(100, Math.max(0, raw)))
  return { score, base, approvalPoints, rejectionPoints, abandonmentPoints, volumeBonus }
}

/** Completion rate over jobs that reached a terminal state. */
export function completionRate(metrics: AgentMetrics): number | null {
  const terminal = metrics.completed + metrics.rejected + metrics.expired
  if (terminal === 0) return null
  return metrics.completed / terminal
}
