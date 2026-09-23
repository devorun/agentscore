// The ONE scoring module. The reputation API (reputation.ts), the settlement
// workers' credit-terms gate (cron.ts, worker.ts) and the web app (imported as
// @shared/score) all compute reputation through this file, so every consumer
// gets the same number from the same chain facts. Pure and dependency-free on
// purpose — no env, no I/O, no clock — so it runs unchanged in Node, Cloudflare
// Workers and the browser. Time enters only through the reference block.
//
// Formula (also on the Arbiter page's methodology section):
//   start 50 (neutral)
//   +8 per approved settlement (diminishing to +2 after 10), weighted by CLIENT
//     DIVERSITY (the k-th settlement from the same client counts fully for
//     k ≤ 3, then at 3/k) and by AGE (90-day half-life)
//   −20 per rejected verdict, by age (180-day half-life); never diversity-
//     discounted — failures cannot be laundered, and they linger longer
//   −10 per expired-unfunded abandonment as provider, by age (180-day half-life)
//   volume bonus min(10, 2.5·log10(1 + decayed, diversity-weighted USDC settled))
//   clamp 0–100
// Every term is a delta from 50, so decay pulls a dormant agent back toward the
// neutral 50, never toward 0. Ages are measured against the timestamp of a
// reference block, never the wall clock, so a score is reproducible: "computed
// at block N". Collateral mirror jobs ([COLLATERAL]) are excluded entirely.

export const BASE_SCORE = 50
export const APPROVAL_HALF_LIFE_DAYS = 90
export const FAILURE_HALF_LIFE_DAYS = 180
export const DORMANT_AFTER_DAYS = 30

const DAY_SECONDS = 86_400
// ERC-8183 JobStatus values scoring cares about. Terminal states are final.
const COMPLETED = 3
const REJECTED = 4
const EXPIRED = 5

/** The block every age is measured against. */
export interface ReferenceBlock {
  block: bigint
  timestamp: number
}

export type ScoreEvent =
  | { kind: 'approval'; jobId: bigint; block: bigint; at: number; client: string; budget6: bigint }
  | { kind: 'rejection'; jobId: bigint; block: bigint; at: number }
  | { kind: 'abandonment'; jobId: bigint; block: bigint; at: number }

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
  distinctClients: number
  /** The same terms with no time decay — the score before decay existed. */
  undecayed: {
    score: number
    approvalPoints: number
    rejectionPoints: number
    abandonmentPoints: number
    volumeBonus: number
  }
  /** Diversity-weighted USDC settled, without and with decay (feeds the volume bonus). */
  volumeUsdc: number
  decayedVolumeUsdc: number
  halfLifeDays: { approval: number; failure: number }
  /** The reference block the score was computed at. */
  asOf: { block: string; timestamp: number }
  /** Time of the most recent settlement that counts (approval or rejection), or null. */
  lastActive: number | null
  /** No counted settlement in the DORMANT_AFTER_DAYS before the reference block. */
  dormant: boolean
}

/** The k-th settlement from the same client: full weight up to 3, then 3/k. */
export function clientWeight(k: number): number {
  return k <= 3 ? 1 : 3 / k
}

/** Share of a settlement's points left after `ageSeconds`: 2^(−age / half-life). */
export function decayFactor(ageSeconds: number, halfLifeDays: number): number {
  return 2 ** (-Math.max(0, ageSeconds) / (halfLifeDays * DAY_SECONDS))
}

// Two-decimal rounding; "+ 0" normalizes −0 so equal inputs serialize equally.
const round2 = (x: number) => Math.round(x * 100) / 100 + 0
const volumeBonusOf = (usdc: number) => Math.min(10, 2.5 * Math.log10(1 + usdc))

export function computeScore(events: readonly ScoreEvent[], ref: ReferenceBlock): ScoreBreakdown {
  // Only what had happened by the reference block, in canonical jobId order,
  // so the result depends on the facts alone — not on input order or the clock.
  const past = events
    .filter((e) => e.block <= ref.block)
    .sort((a, b) => (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0))
  const ageOf = (e: ScoreEvent) => ref.timestamp - e.at

  const perClient = new Map<string, number>()
  let approvalCount = 0
  let approvals = 0
  let approvalsUndecayed = 0
  let volume = 0
  let volumeUndecayed = 0
  let rejections = 0
  let rejectionsUndecayed = 0
  let abandonment = 0
  let abandonmentUndecayed = 0
  let lastActive: number | null = null

  for (const e of past) {
    if (e.kind === 'approval') {
      const key = e.client.toLowerCase()
      const k = (perClient.get(key) ?? 0) + 1
      perClient.set(key, k)
      const weight = clientWeight(k) // diversity...
      const decay = decayFactor(ageOf(e), APPROVAL_HALF_LIFE_DAYS) // ...times age
      const rate = approvalCount++ < 10 ? 8 : 2 // global diminishing after the 10th settlement
      approvalsUndecayed += rate * weight
      approvals += rate * weight * decay
      const usdc = Number(e.budget6) / 1e6
      volumeUndecayed += usdc * weight
      volume += usdc * weight * decay
    } else if (e.kind === 'rejection') {
      rejectionsUndecayed -= 20
      rejections -= 20 * decayFactor(ageOf(e), FAILURE_HALF_LIFE_DAYS)
    } else {
      abandonmentUndecayed -= 10
      abandonment -= 10 * decayFactor(ageOf(e), FAILURE_HALF_LIFE_DAYS)
    }
    if (e.kind !== 'abandonment' && (lastActive === null || e.at > lastActive)) lastActive = e.at
  }

  const clampRound = (raw: number) => Math.round(Math.min(100, Math.max(0, raw)))
  const approvalPoints = round2(approvals)
  const rejectionPoints = round2(rejections)
  const abandonmentPoints = round2(abandonment)
  const volumeBonus = volumeBonusOf(volume)
  const undecayedApproval = round2(approvalsUndecayed)
  const undecayedVolumeBonus = volumeBonusOf(volumeUndecayed)

  return {
    score: clampRound(BASE_SCORE + approvalPoints + rejectionPoints + abandonmentPoints + volumeBonus),
    base: BASE_SCORE,
    approvalPoints,
    rejectionPoints,
    abandonmentPoints,
    volumeBonus,
    distinctClients: perClient.size,
    undecayed: {
      score: clampRound(BASE_SCORE + undecayedApproval + rejectionsUndecayed + abandonmentUndecayed + undecayedVolumeBonus),
      approvalPoints: undecayedApproval,
      rejectionPoints: rejectionsUndecayed,
      abandonmentPoints: abandonmentUndecayed,
      volumeBonus: undecayedVolumeBonus,
    },
    volumeUsdc: round2(volumeUndecayed),
    decayedVolumeUsdc: round2(volume),
    halfLifeDays: { approval: APPROVAL_HALF_LIFE_DAYS, failure: FAILURE_HALF_LIFE_DAYS },
    asOf: { block: ref.block.toString(), timestamp: ref.timestamp },
    lastActive,
    dormant: lastActive !== null && ref.timestamp - lastActive >= DORMANT_AFTER_DAYS * DAY_SECONDS,
  }
}

export function completionRate(m: AgentMetrics): number | null {
  const terminal = m.completed + m.rejected + m.expired
  return terminal === 0 ? null : m.completed / terminal
}

/** Collateral mirror jobs are an escrow mechanism, not work — never scored. */
export function isCollateralJob(description: string): boolean {
  return /^\s*\[COLLATERAL\]/i.test(description)
}

// ---- Chain facts → score ---------------------------------------------------
// The I/O layers (API, workers, browser fallback) gather these facts; turning
// them into events + metrics lives here, so every consumer derives the same way.

/** One job where the agent is the provider. `status` is its current status. */
export interface JobFact {
  jobId: bigint
  client: string
  budget6: bigint
  description: string
  status: number
  createdBlock: bigint
  createdAt: number
  expiredAt: number
}

/** When a job settled: its PaymentReleased (approval) or JobRejected log. */
export interface SettlementFact {
  jobId: bigint
  block: bigint
  timestamp: number
  /** PaymentReleased amount (6 decimals); unset for rejections. */
  amount6?: bigint
}

export interface ReputationFacts {
  jobs: readonly JobFact[]
  /** PaymentReleased logs where the agent is the provider. */
  payments: readonly SettlementFact[]
  /** JobRejected logs of the agent's rejected jobs. */
  rejections: readonly SettlementFact[]
  /** Rejected job ids overturned by a second-arbiter appeal by the reference block. */
  overturned: ReadonlySet<string>
}

export interface DerivedReputation {
  breakdown: ScoreBreakdown
  metrics: AgentMetrics
  overturnedRejections: number
}

/**
 * Reputation as of `ref`: only jobs created — and settlements logged — at or
 * before the reference block count, so the same block always yields the same
 * score. A terminal job whose settlement log is not indexed yet (the explorer
 * trails the chain by seconds) is dated conservatively rather than dropped:
 * an approval at the job's creation (most decayed), a rejection at the
 * reference block (least decayed) — missing data never flatters an agent.
 */
export function deriveReputation(facts: ReputationFacts, ref: ReferenceBlock): DerivedReputation {
  const byJob = (logs: readonly SettlementFact[]) => new Map(logs.map((l) => [l.jobId.toString(), l]))
  const paymentOf = byJob(facts.payments)
  const rejectionOf = byJob(facts.rejections)
  const jobs = facts.jobs
    .filter((j) => j.createdBlock <= ref.block)
    .sort((a, b) => (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0))

  const events: ScoreEvent[] = []
  let completed = 0
  let rejected = 0
  let overturnedRejections = 0
  let expired = 0
  let expiredUnfunded = 0
  let settled6 = 0n

  for (const job of jobs) {
    if (isCollateralJob(job.description)) continue
    const id = job.jobId.toString()
    if (job.status === COMPLETED) {
      const log = paymentOf.get(id)
      if (log && log.block > ref.block) continue // settled after the reference block
      completed += 1
      settled6 += job.budget6
      events.push({
        kind: 'approval',
        jobId: job.jobId,
        client: job.client,
        budget6: job.budget6,
        block: log?.block ?? job.createdBlock,
        at: log?.timestamp ?? job.createdAt,
      })
    } else if (job.status === REJECTED) {
      const log = rejectionOf.get(id)
      if (log && log.block > ref.block) continue
      // An overturned rejection must not keep punishing the agent: the escrow is
      // final, but the reputation record is corrected — no −20 is applied.
      if (facts.overturned.has(id)) {
        overturnedRejections += 1
        continue
      }
      rejected += 1
      events.push({ kind: 'rejection', jobId: job.jobId, block: log?.block ?? ref.block, at: log?.timestamp ?? ref.timestamp })
    } else if (job.status === EXPIRED && job.expiredAt <= ref.timestamp) {
      expired += 1
      if (job.budget6 === 0n) {
        expiredUnfunded += 1
        // Abandonment is dated at the deadline the provider let pass.
        events.push({ kind: 'abandonment', jobId: job.jobId, block: job.createdBlock, at: job.expiredAt })
      }
    }
  }

  const earnings6 = facts.payments.reduce((sum, p) => (p.block <= ref.block ? sum + (p.amount6 ?? 0n) : sum), 0n)
  const metrics: AgentMetrics = { totalJobs: jobs.length, completed, rejected, expired, expiredUnfunded, settled6, earnings6 }
  return { breakdown: computeScore(events, ref), metrics, overturnedRejections }
}
