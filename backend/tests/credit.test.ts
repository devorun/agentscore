import { describe, expect, it } from 'vitest'
import { parseUnits } from 'viem'
import { creditTerms, creditTermsEarned, collateralDescription, isCollateralJob, parseTermsMarker, termsMarker } from '../src/lib/credit.js'
import { clientWeight, computeScore, type ScoreEvent } from '../src/lib/score.js'

// Settlements at the reference block itself (age 0): no decay, so these pin the
// diversity weighting exactly as it was before decay existed.
const REF = { block: 100n, timestamp: 1_790_000_000 }
const completionsFrom = (clients: string[]): ScoreEvent[] =>
  clients.map((client, i) => ({ kind: 'approval', jobId: BigInt(i + 1), block: REF.block, at: REF.timestamp, client, budget6: parseUnits('2', 6) }))
const rejections = (n: number): ScoreEvent[] =>
  Array.from({ length: n }, (_, i) => ({ kind: 'rejection', jobId: BigInt(i + 1), block: REF.block, at: REF.timestamp }))

describe('credit tiers (score has economic consequence)', () => {
  it('maps the three bands', () => {
    expect(creditTerms(80).tier).toBe('credit')
    expect(creditTerms(95).advancePct).toBe(30)
    expect(creditTerms(79).tier).toBe('standard')
    expect(creditTerms(50).tier).toBe('standard')
    expect(creditTerms(49).tier).toBe('collateral')
    expect(creditTerms(49).collateralPct).toBe(50)
    expect(creditTerms(0).tier).toBe('collateral')
  })
})

describe('client-diversity weighting (self-farming decays)', () => {
  it('full weight for the first three settlements per client, then 3/k', () => {
    expect(clientWeight(1)).toBe(1)
    expect(clientWeight(3)).toBe(1)
    expect(clientWeight(4)).toBe(0.75)
    expect(clientWeight(6)).toBe(0.5)
  })

  it('N jobs from N clients beat N jobs from one client, materially', () => {
    const diverse = computeScore(completionsFrom(['0xa', '0xb', '0xc', '0xd', '0xe', '0xf', '0x1', '0x2']), REF)
    const farmed = computeScore(completionsFrom(Array(8).fill('0xa')), REF)
    expect(diverse.approvalPoints).toBe(64) // 8 × 8, all full weight
    expect(farmed.approvalPoints).toBeLessThan(46) // 8×(3 + 3/4 + 3/5 + 3/6 + 3/7 + 3/8) ≈ 45.2
    // Compare pre-clamp points: the 0–100 clamp can mask the gap at high totals.
    expect(diverse.approvalPoints - farmed.approvalPoints).toBeGreaterThanOrEqual(18)
    expect(diverse.distinctClients).toBe(8)
    expect(farmed.distinctClients).toBe(1)
  })

  it('a young honest agent is unaffected (grace of three per client)', () => {
    const three = computeScore(completionsFrom(['0xa', '0xa', '0xa']), REF)
    expect(three.approvalPoints).toBe(24) // no discount inside the grace window
  })

  it('rejections are never diversity-discounted', () => {
    const s = computeScore(rejections(4), REF)
    expect(s.rejectionPoints).toBe(-80)
  })

  it('client casing does not split identity', () => {
    const s = computeScore(completionsFrom(['0xAB', '0xab', '0xAb', '0xaB']), REF)
    expect(s.distinctClients).toBe(1)
    expect(s.approvalPoints).toBe(8 * (3 + 3 / 4))
  })
})

describe('terms markers (the onchain record of the deal)', () => {
  it('round-trips a collateral marker', () => {
    const m = parseTermsMarker(`Do the work. ${termsMarker({ tier: 'collateral', score: 46, collateralJobId: 158800n })}`)
    expect(m).toEqual({ tier: 'collateral', score: 46, collateralJobId: 158800n })
  })

  it('round-trips a credit marker with an advance tx', () => {
    const advanceTx = `0x${'ab'.repeat(32)}` as const
    const m = parseTermsMarker(termsMarker({ tier: 'credit', score: 82, advanceTx }))
    expect(m?.tier).toBe('credit')
    expect(m?.advanceTx).toBe(advanceTx)
  })

  it('returns null on absent or malformed markers', () => {
    expect(parseTermsMarker('Enrich the wallet dataset.')).toBeNull()
    expect(parseTermsMarker('[TERMS tier=nonsense]')).toBeNull()
  })

  it('flags collateral mirror jobs for reputation exclusion', () => {
    expect(isCollateralJob(collateralDescription('0xagent', '1'))).toBe(true)
    expect(isCollateralJob('[JUDGED] write a memo')).toBe(false)
  })
})

describe('credit-terms gate (credit must be earned at the hire block)', () => {
  const credit = parseTermsMarker(termsMarker({ tier: 'credit', score: 82, advanceTx: `0x${'ab'.repeat(32)}` }))!

  it('honors a credit claim only when the score at hire reaches the credit band', () => {
    expect(creditTermsEarned(credit, 82)).toBe(true)
    expect(creditTermsEarned(credit, 80)).toBe(true)
    expect(creditTermsEarned(credit, 79)).toBe(false)
  })

  it('does not score-gate the tiers that keep the full escrow', () => {
    expect(creditTermsEarned({ tier: 'standard' }, 10)).toBe(true)
    expect(creditTermsEarned({ tier: 'collateral', collateralJobId: 1n }, 95)).toBe(true)
  })
})
