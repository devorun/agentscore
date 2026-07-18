import { describe, expect, it } from 'vitest'
import { enrich, enrichTampered, hashOutput, loadInputDataset, verify } from '../src/lib/enrichment.js'

const input = loadInputDataset()

describe('real deterministic enrichment', () => {
  it('dedupes by address and labels risk deterministically', () => {
    const out = enrich(input)
    const addrs = out.map((r) => r.address)
    expect(new Set(addrs).size).toBe(addrs.length) // no duplicate addresses
    expect(out.length).toBeLessThan(input.length) // duplicates were removed
    expect(out.every((r) => ['low', 'medium', 'high'].includes(r.risk))).toBe(true)
    expect(hashOutput(enrich(input))).toBe(hashOutput(out)) // deterministic
  })

  it('risk labels follow the documented thresholds', () => {
    const out = enrich(input)
    const high = out.find((r) => r.balanceUsd >= 100_000 || r.txCount >= 1_000)
    expect(high?.risk).toBe('high')
    const low = out.find((r) => r.balanceUsd < 10_000 && r.txCount < 100)
    expect(low?.risk).toBe('low')
  })
})

describe('arbiter verification', () => {
  it('accepts a correct output whose hash matches the onchain submission', () => {
    const out = enrich(input)
    const res = verify(input, out, hashOutput(out))
    expect(res.ok).toBe(true)
    expect(res.checks).toMatchObject({ schema: true, rowCount: true, noDuplicates: true, checksumMatch: true, exactMatch: true })
  })

  it('rejects a tampered output (duplicates left in) even though its hash is honest', () => {
    const bad = enrichTampered(input)
    const res = verify(input, bad, hashOutput(bad))
    expect(res.ok).toBe(false)
    expect(res.checks.checksumMatch).toBe(true) // integrity holds…
    expect(res.checks.noDuplicates).toBe(false) // …but the work is wrong
    expect(res.checks.rowCount).toBe(false)
    expect(res.checks.exactMatch).toBe(false)
  })

  it('rejects when the submitted hash does not match the stored output', () => {
    const out = enrich(input)
    const res = verify(input, out, `0x${'00'.repeat(32)}`)
    expect(res.ok).toBe(false)
    expect(res.checks.checksumMatch).toBe(false)
  })
})
