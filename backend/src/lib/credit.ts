// Credit terms — the score has economic consequence. Tiers (thresholds per the
// project design): score >= 80 -> credit (client pays part as an upfront advance,
// the rest through standard escrow); 50-79 -> standard full escrow; < 50 -> the
// agent must post slashable collateral before work starts.
//
// No new Solidity: the advance is a direct client->agent USDC transfer, and the
// collateral is a mirror job on the SAME ERC-8183 reference contract with roles
// inverted (agent funds, client is provider, our arbiter is evaluator), so
// Circle's audited escrow custodies it and "our contracts hold no funds" stays
// intact. Slash = arbiter completes the mirror job (pays the client); release =
// arbiter rejects it (refunds the agent). Terms are recorded in the main job's
// onchain description via the [TERMS ...] marker — publicly auditable, no new
// contract. Enforcement is orchestration + self-interest, not chain law.

export type CreditTier = 'credit' | 'standard' | 'collateral'

export const CREDIT_SCORE_MIN = 80
export const STANDARD_SCORE_MIN = 50
export const ADVANCE_PCT = Number(process.env.CREDIT_ADVANCE_PCT || 30)
export const COLLATERAL_PCT = Number(process.env.CREDIT_COLLATERAL_PCT || 50)

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

// ---- Onchain description markers -------------------------------------------
// The collateral mirror job is created BEFORE the main job (the main job's
// marker references it), so the link is one-directional: main -> collateral.

/** Description prefix of a collateral mirror job. Excluded from reputation. */
export function collateralDescription(agent: string, collateralUsdc: string): string {
  return `[COLLATERAL] Slashable collateral of ${collateralUsdc} USDC posted by agent ${agent}. Released back on settlement of the linked main job; forfeited to the client if that job is rejected.`
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

/** Marker embedded in the MAIN job's onchain description. */
export function termsMarker(m: TermsMarker): string {
  const parts = [`tier=${m.tier}`]
  if (m.score !== undefined) parts.push(`score=${m.score}`)
  if (m.advanceTx) parts.push(`advance=${m.advanceTx}`)
  if (m.collateralJobId !== undefined) parts.push(`collateral=#${m.collateralJobId}`)
  return `[TERMS ${parts.join(' ')}]`
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
