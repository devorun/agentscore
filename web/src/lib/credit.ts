// Credit terms — the score has economic consequence (mirrors backend/src/lib/
// credit.ts). Tiers: score >= 80 -> credit (30% direct advance + 70% escrow);
// 50-79 -> standard full escrow; < 50 -> 50% slashable collateral, posted as a
// mirror job on the SAME ERC-8183 reference contract (agent funds it, the
// client is its provider, the arbiter its evaluator) — Circle's audited escrow
// custodies it and our contracts still hold no funds. Enforcement is
// orchestration + self-interest, not chain law.

export type CreditTier = 'credit' | 'standard' | 'collateral'

export const CREDIT_SCORE_MIN = 80
export const STANDARD_SCORE_MIN = 50
export const ADVANCE_PCT = 30
export const COLLATERAL_PCT = 50

export interface CreditTerms {
  tier: CreditTier
  advancePct: number
  collateralPct: number
  headline: string
  detail: string
}

export function creditTerms(score: number): CreditTerms {
  if (score >= CREDIT_SCORE_MIN) {
    return {
      tier: 'credit',
      advancePct: ADVANCE_PCT,
      collateralPct: 0,
      headline: `Credit terms — ${ADVANCE_PCT}% advance`,
      detail: `Score ${score} qualifies for working capital: the client pays ${ADVANCE_PCT}% upfront as a direct advance and escrows the remaining ${100 - ADVANCE_PCT}%.`,
    }
  }
  if (score >= STANDARD_SCORE_MIN) {
    return {
      tier: 'standard',
      advancePct: 0,
      collateralPct: 0,
      headline: 'Standard terms — full escrow',
      detail: `Score ${score} trades on standard terms: the client escrows the full budget before work starts.`,
    }
  }
  return {
    tier: 'collateral',
    advancePct: 0,
    collateralPct: COLLATERAL_PCT,
    headline: `Collateral required — ${COLLATERAL_PCT}% slashable`,
    detail: `Score ${score} must post ${COLLATERAL_PCT}% of the budget as slashable collateral (escrowed in the reference contract) before the client funds. Rejected work forfeits it to the client.`,
  }
}

export function isCollateralJob(description: string): boolean {
  return /^\s*\[COLLATERAL\]/i.test(description)
}

export interface TermsMarker {
  tier: CreditTier
  score?: number
  advanceTx?: `0x${string}`
  collateralJobId?: bigint
}

export function parseTermsMarker(description: string): TermsMarker | null {
  const match = description.match(/\[TERMS\s+([^\]]+)\]/i)
  if (!match) return null
  const fields = new Map<string, string>()
  for (const pair of match[1].trim().split(/\s+/)) {
    const eq = pair.indexOf('=')
    if (eq > 0) fields.set(pair.slice(0, eq).toLowerCase(), pair.slice(eq + 1))
  }
  const tier = fields.get('tier') as CreditTier | undefined
  if (tier !== 'credit' && tier !== 'standard' && tier !== 'collateral') return null
  const marker: TermsMarker = { tier }
  const score = fields.get('score')
  if (score && /^\d+$/.test(score)) marker.score = Number(score)
  const advance = fields.get('advance')
  if (advance && /^0x[0-9a-fA-F]{64}$/.test(advance)) marker.advanceTx = advance as `0x${string}`
  const collateral = fields.get('collateral')
  if (collateral && /^#\d+$/.test(collateral)) marker.collateralJobId = BigInt(collateral.slice(1))
  return marker
}
