import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { keccak256, toHex } from 'viem'

// Real, deterministic data-enrichment work — $0, no LLM. The agent dedupes a
// wallet-activity dataset and risk-labels each row; the arbiter re-derives the
// same result to verify. Pure functions so both sides agree bit-for-bit.

export interface WalletRow {
  address: string
  balanceUsd: number
  txCount: number
}
export interface EnrichedRow extends WalletRow {
  risk: 'low' | 'medium' | 'high'
}

export function loadInputDataset(): WalletRow[] {
  const path = fileURLToPath(new URL('../../data/input/wallets.json', import.meta.url))
  return JSON.parse(readFileSync(path, 'utf8')) as WalletRow[]
}

export function riskLabel(r: WalletRow): EnrichedRow['risk'] {
  if (r.balanceUsd >= 100_000 || r.txCount >= 1_000) return 'high'
  if (r.balanceUsd >= 10_000 || r.txCount >= 100) return 'medium'
  return 'low'
}

/** Correct work: dedupe by address (first wins), risk-label, sort by address. */
export function enrich(rows: WalletRow[]): EnrichedRow[] {
  const seen = new Set<string>()
  const deduped: WalletRow[] = []
  for (const r of rows) {
    const key = r.address.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(r)
    }
  }
  return deduped
    .map((r) => ({ address: r.address.toLowerCase(), balanceUsd: r.balanceUsd, txCount: r.txCount, risk: riskLabel(r) }))
    .sort((a, b) => a.address.localeCompare(b.address))
}

/** A faulty run for the reject demo: skips dedupe, leaving duplicate rows. */
export function enrichTampered(rows: WalletRow[]): EnrichedRow[] {
  return rows
    .map((r) => ({ address: r.address.toLowerCase(), balanceUsd: r.balanceUsd, txCount: r.txCount, risk: riskLabel(r) }))
    .sort((a, b) => a.address.localeCompare(b.address))
}

export function canonicalize(rows: EnrichedRow[]): string {
  return JSON.stringify(rows.map((r) => ({ address: r.address.toLowerCase(), balanceUsd: r.balanceUsd, txCount: r.txCount, risk: r.risk })))
}

export function hashOutput(rows: EnrichedRow[]): `0x${string}` {
  return keccak256(toHex(canonicalize(rows)))
}

export interface VerifyChecks {
  schema: boolean
  rowCount: boolean
  noDuplicates: boolean
  checksumMatch: boolean
  exactMatch: boolean
}
export interface VerifyResult {
  ok: boolean
  checks: VerifyChecks
  expectedRowCount: number
  gotRowCount: number
  outputHash: string
}

/**
 * Genuine verification: recompute the correct answer from the canonical input,
 * confirm the agent's stored output hashes to what it submitted onchain, has the
 * right schema, no duplicates, the right row count, and matches the re-derived
 * result exactly. Any failure → the arbiter rejects and refunds.
 */
export function verify(input: WalletRow[], output: EnrichedRow[], onchainHash: string): VerifyResult {
  const expected = enrich(input)
  const validRisk = new Set(['low', 'medium', 'high'])
  const schema =
    Array.isArray(output) &&
    output.every(
      (r) =>
        typeof r.address === 'string' && typeof r.balanceUsd === 'number' && typeof r.txCount === 'number' && validRisk.has(r.risk),
    )
  const addrs = output.map((r) => r.address.toLowerCase())
  const noDuplicates = new Set(addrs).size === addrs.length
  const rowCount = output.length === expected.length
  const checksumMatch = hashOutput(output).toLowerCase() === onchainHash.toLowerCase()
  const exactMatch = canonicalize(output) === canonicalize(expected)
  const ok = schema && noDuplicates && rowCount && checksumMatch && exactMatch
  return { ok, checks: { schema, rowCount, noDuplicates, checksumMatch, exactMatch }, expectedRowCount: expected.length, gotRowCount: output.length, outputHash: hashOutput(output) }
}
