import { describe, expect, it } from 'vitest'
import { agentShouldSetBudget, agentShouldSubmit, arbiterVerdict } from '../src/worker.js'
import { completionRate, computeScore } from '../src/lib/score.js'

describe('worker decision logic', () => {
  it('agent sets a budget only on an Open job with no budget', () => {
    expect(agentShouldSetBudget({ status: 0, budget: 0n })).toBe(true)
    expect(agentShouldSetBudget({ status: 0, budget: 10_000_000n })).toBe(false)
    expect(agentShouldSetBudget({ status: 1, budget: 0n })).toBe(false)
  })

  it('agent submits only once the job is Funded', () => {
    expect(agentShouldSubmit({ status: 1 })).toBe(true)
    expect(agentShouldSubmit({ status: 0 })).toBe(false)
    expect(agentShouldSubmit({ status: 2 })).toBe(false)
  })

  it('arbiter approves a submitted job before deadline, rejects after, skips otherwise', () => {
    const now = 1_000
    expect(arbiterVerdict({ status: 2, expiredAt: 2_000n }, now)).toBe('approve')
    expect(arbiterVerdict({ status: 2, expiredAt: 500n }, now)).toBe('reject')
    expect(arbiterVerdict({ status: 1, expiredAt: 2_000n }, now)).toBe('skip')
    expect(arbiterVerdict({ status: 3, expiredAt: 2_000n }, now)).toBe('skip')
  })
})

describe('reputation scoring', () => {
  const zero = { totalJobs: 0, completed: 0, rejected: 0, expired: 0, expiredUnfunded: 0, settled6: 0n, earnings6: 0n }

  it('a new agent starts at 50', () => {
    expect(computeScore(zero, []).score).toBe(50)
    expect(completionRate(zero)).toBeNull()
  })

  it('one approved settlement raises the score above base', () => {
    const m = { ...zero, totalJobs: 1, completed: 1, settled6: 10_000_000n, earnings6: 10_000_000n }
    const s = computeScore(m, [{ client: '0xclient', budget6: 10_000_000n }])
    expect(s.approvalPoints).toBe(8)
    expect(s.score).toBeGreaterThan(50)
  })

  it('a rejected verdict penalizes and completion rate reflects it', () => {
    const m = { ...zero, totalJobs: 2, completed: 1, rejected: 1, settled6: 10_000_000n, earnings6: 10_000_000n }
    expect(computeScore(m, [{ client: '0xclient', budget6: 10_000_000n }]).rejectionPoints).toBe(-20)
    expect(completionRate(m)).toBeCloseTo(0.5)
  })

  it('clamps to 0–100', () => {
    const bad = { ...zero, totalJobs: 5, rejected: 5 }
    expect(computeScore(bad, []).score).toBe(0)
  })
})
