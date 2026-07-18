import { formatUnits } from 'viem'
import { USDC_DECIMALS } from './config.js'

// Scoring formula (identical to the frontend and the on-site methodology):
// start 50; +8 per approved settlement (diminishing to +2 after 10); −20 per
// rejected verdict; −10 per expired-unfunded abandonment (as provider); volume
// bonus min(10, 2.5·log10(1 + lifetime USDC settled)); clamp 0–100.
export interface AgentMetrics {
  totalJobs: number
  completed: number
  rejected: number
  expired: number
  expiredUnfunded: number
  settled6: bigint
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

export function computeScore(m: AgentMetrics): ScoreBreakdown {
  const base = 50
  const full = Math.min(m.completed, 10)
  const reduced = Math.max(0, m.completed - 10)
  const approvalPoints = full * 8 + reduced * 2
  const rejectionPoints = -20 * m.rejected
  const abandonmentPoints = -10 * m.expiredUnfunded
  const settledUsdc = Number(formatUnits(m.settled6, USDC_DECIMALS))
  const volumeBonus = Math.min(10, 2.5 * Math.log10(1 + settledUsdc))
  const raw = base + approvalPoints + rejectionPoints + abandonmentPoints + volumeBonus
  const score = Math.round(Math.min(100, Math.max(0, raw)))
  return { score, base, approvalPoints, rejectionPoints, abandonmentPoints, volumeBonus }
}

export function completionRate(m: AgentMetrics): number | null {
  const terminal = m.completed + m.rejected + m.expired
  return terminal === 0 ? null : m.completed / terminal
}
