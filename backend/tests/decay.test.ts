import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseUnits } from 'viem'
import {
  APPROVAL_HALF_LIFE_DAYS,
  computeScore,
  decayFactor,
  deriveReputation,
  FAILURE_HALF_LIFE_DAYS,
  type JobFact,
  type ReferenceBlock,
  type ScoreEvent,
} from '../src/lib/score.js'

const DAY = 86_400
const T0 = 1_780_000_000 // when the settlements below happened
const at = (days: number): ReferenceBlock => ({ block: 1_000_000n + BigInt(days), timestamp: T0 + days * DAY })

const approval = (jobId: number, client: string, daysBeforeT0 = 0, usdc = '2'): ScoreEvent => ({
  kind: 'approval',
  jobId: BigInt(jobId),
  block: 1_000_000n,
  at: T0 - daysBeforeT0 * DAY,
  client,
  budget6: parseUnits(usdc, 6),
})
const rejection = (jobId: number, daysBeforeT0 = 0): ScoreEvent => ({
  kind: 'rejection',
  jobId: BigInt(jobId),
  block: 1_000_000n,
  at: T0 - daysBeforeT0 * DAY,
})

afterEach(() => vi.useRealTimers())

describe('time decay', () => {
  it('halves an approval every 90 days and a failure every 180', () => {
    expect([APPROVAL_HALF_LIFE_DAYS, FAILURE_HALF_LIFE_DAYS]).toEqual([90, 180])
    expect(decayFactor(0, APPROVAL_HALF_LIFE_DAYS)).toBe(1)
    expect(decayFactor(90 * DAY, APPROVAL_HALF_LIFE_DAYS)).toBeCloseTo(0.5, 12)
    expect(decayFactor(180 * DAY, FAILURE_HALF_LIFE_DAYS)).toBeCloseTo(0.5, 12)
    expect(decayFactor(-DAY, APPROVAL_HALF_LIFE_DAYS)).toBe(1) // never amplifies
  })

  it('a dormant agent drifts back to the neutral 50 — from above and from below', () => {
    const good = [1, 2, 3, 4, 5].map((id) => approval(id, `0x${id}`))
    expect([0, 45, 180, 365, 730].map((d) => computeScore(good, at(d)).score)).toEqual([93, 81, 61, 53, 50])

    // Failures drift up to 50, not down to 0 — decay is toward neutral.
    const bad = [rejection(1), rejection(2), rejection(3)]
    expect([0, 180, 365, 730, 1460].map((d) => computeScore(bad, at(d)).score)).toEqual([0, 20, 35, 46, 50])

    // A mixed record ends neutral as well.
    expect(computeScore([...good, rejection(6)], at(1460)).score).toBe(50)
  })

  it('flags dormancy after 30 days without a settlement', () => {
    const history = [approval(1, '0xa'), approval(2, '0xb')]
    expect(computeScore(history, at(0))).toMatchObject({ lastActive: T0, dormant: false })
    expect(computeScore(history, at(29)).dormant).toBe(false)
    expect(computeScore(history, at(30))).toMatchObject({ lastActive: T0, dormant: true })
    expect(computeScore([], at(0))).toMatchObject({ lastActive: null, dormant: false }) // never settled ≠ dormant
  })

  it('a recent approval outweighs an old one', () => {
    const recent = computeScore([approval(1, '0xa', 2)], at(0))
    const old = computeScore([approval(1, '0xa', 180)], at(0))
    expect(recent.approvalPoints).toBeGreaterThan(old.approvalPoints)
    expect(recent.score).toBeGreaterThan(old.score)
    expect(old.approvalPoints).toBe(2) // 8 × 2^(−180/90)
  })

  it('a rejection outlasts an approval of the same age', () => {
    const s = computeScore([approval(1, '0xa', 180), rejection(2, 180)], at(0))
    expect(s.approvalPoints).toBe(2) // 8 × 1/4 left after 2 half-lives
    expect(s.rejectionPoints).toBe(-10) // −20 × 1/2 left after 1 half-life
    const kept = (decayed: number, full: number) => decayed / full
    expect(kept(s.rejectionPoints, s.undecayed.rejectionPoints)).toBeGreaterThan(kept(s.approvalPoints, s.undecayed.approvalPoints))
  })

  it('decay multiplies with client-diversity weighting', () => {
    // Four settlements from one client, 90 days old: 8 × (1 + 1 + 1 + 3/4) × 1/2.
    const s = computeScore([1, 2, 3, 4].map((id) => approval(id, '0xa', 90)), at(0))
    expect(s.undecayed.approvalPoints).toBe(30)
    expect(s.approvalPoints).toBe(15)
  })

  it('the volume bonus uses decayed volume', () => {
    const s = computeScore([approval(1, '0xa', 90, '99')], at(0))
    expect(s.volumeUsdc).toBe(99)
    expect(s.decayedVolumeUsdc).toBe(49.5)
    expect(s.undecayed.volumeBonus).toBeCloseTo(5, 10) // 2.5 × log10(1 + 99)
    expect(s.volumeBonus).toBeCloseTo(2.5 * Math.log10(50.5), 10)
  })

  it('with no decay the score is exactly the pre-decay formula', () => {
    const s = computeScore([approval(1, '0xa'), approval(2, '0xb'), rejection(3)], at(0))
    expect(s.score).toBe(s.undecayed.score)
    expect(s.approvalPoints).toBe(s.undecayed.approvalPoints)
  })

  it('is deterministic for the same block: input order and wall clock do not matter', () => {
    const events = [approval(3, '0xc', 10), rejection(2, 40), approval(1, '0xa', 70), approval(4, '0xa', 5)]
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const first = computeScore(events, at(20))
    vi.setSystemTime(new Date('2031-06-30T12:00:00Z'))
    const second = computeScore([...events].reverse(), at(20))
    expect(second).toEqual(first)
    expect(first.asOf).toEqual({ block: at(20).block.toString(), timestamp: at(20).timestamp })
    expect(computeScore(events, at(21))).not.toEqual(first) // a different block is a different score
  })

  it('ignores events after the reference block', () => {
    const later: ScoreEvent = { ...approval(9, '0xz'), block: 2_000_000n }
    expect(computeScore([later], at(0)).score).toBe(50)
  })
})

describe('deriveReputation (chain facts → score as of a block)', () => {
  const ref: ReferenceBlock = { block: 500n, timestamp: T0 }
  const job = (jobId: number, status: number, extra: Partial<JobFact> = {}): JobFact => ({
    jobId: BigInt(jobId),
    client: '0xc1',
    budget6: parseUnits('2', 6),
    description: 'Enrich the wallet dataset.',
    status,
    createdBlock: 100n,
    createdAt: T0 - 180 * DAY,
    expiredAt: T0 - 170 * DAY,
    ...extra,
  })
  const settled = (jobId: number, block: bigint, daysBeforeT0: number, amount6?: bigint) => ({
    jobId: BigInt(jobId),
    block,
    timestamp: T0 - daysBeforeT0 * DAY,
    amount6,
  })

  it('dates each settlement by its own log, not by job creation', () => {
    const r = deriveReputation(
      { jobs: [job(1, 3)], payments: [settled(1, 400n, 90, parseUnits('2', 6))], rejections: [], overturned: new Set() },
      ref,
    )
    expect(r.breakdown.approvalPoints).toBe(4) // 90 days since settling, not 180 since creation
    expect(r.breakdown.lastActive).toBe(T0 - 90 * DAY)
    expect(r.metrics).toMatchObject({ completed: 1, earnings6: parseUnits('2', 6) })
  })

  it('counts only what had settled by the reference block', () => {
    const facts = { jobs: [job(1, 3), job(2, 4)], payments: [settled(1, 600n, 0)], rejections: [settled(2, 700n, 0)], overturned: new Set<string>() }
    const r = deriveReputation(facts, ref)
    expect(r.metrics).toMatchObject({ completed: 0, rejected: 0 })
    expect(r.breakdown.score).toBe(50)
  })

  it('excludes collateral mirror jobs and never penalizes an overturned rejection', () => {
    const r = deriveReputation(
      {
        jobs: [job(1, 3, { description: '[COLLATERAL] Slashable collateral of 1 USDC' }), job(2, 4), job(3, 4)],
        payments: [settled(1, 400n, 0)],
        rejections: [settled(2, 400n, 0), settled(3, 400n, 0)],
        overturned: new Set(['3']),
      },
      ref,
    )
    expect(r.metrics).toMatchObject({ completed: 0, rejected: 1 })
    expect(r.overturnedRejections).toBe(1)
    expect(r.breakdown.rejectionPoints).toBe(-20)
  })

  it('dates a settlement the explorer has not indexed yet conservatively', () => {
    // Approval → at job creation (most decayed); rejection → at the reference (least).
    const r = deriveReputation({ jobs: [job(1, 3), job(2, 4)], payments: [], rejections: [], overturned: new Set() }, ref)
    expect(r.breakdown.approvalPoints).toBe(2) // created 180 days ago
    expect(r.breakdown.rejectionPoints).toBe(-20)
  })

  it('dates an abandonment at its missed deadline, on the failure half-life', () => {
    const r = deriveReputation({ jobs: [job(1, 5, { budget6: 0n, expiredAt: T0 - 180 * DAY })], payments: [], rejections: [], overturned: new Set() }, ref)
    expect(r.metrics).toMatchObject({ expired: 1, expiredUnfunded: 1 })
    expect(r.breakdown.abandonmentPoints).toBe(-5)
  })
})
