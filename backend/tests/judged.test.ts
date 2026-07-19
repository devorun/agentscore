import { describe, expect, it } from 'vitest'
import { keccak256, toHex } from 'viem'
import {
  agentWriteMemo,
  isJudgedJob,
  isLazyRun,
  judgedSpec,
  llmKeyPresent,
  parseJudgeJson,
  reasonHashOf,
} from '../src/lib/judged.js'

describe('judged job detection', () => {
  it('detects [JUDGED] case-insensitively and not on plain jobs', () => {
    expect(isJudgedJob('[JUDGED] Write a memo.')).toBe(true)
    expect(isJudgedJob('[judged] Write a memo.')).toBe(true)
    expect(isJudgedJob('Enrich the wallet dataset: dedupe and risk-label.')).toBe(false)
  })

  it('detects [LAZY] only when tagged', () => {
    expect(isLazyRun('[JUDGED] [LAZY] Write a memo.')).toBe(true)
    expect(isLazyRun('[JUDGED] Write a memo.')).toBe(false)
  })

  it('strips tags from the spec', () => {
    expect(judgedSpec('[JUDGED] [LAZY] Write a  memo.')).toBe('Write a memo.')
    expect(judgedSpec('[JUDGED] Write a memo.')).toBe('Write a memo.')
  })
})

describe('reason hash commitment', () => {
  it('is the keccak of the exact reasoning text', () => {
    const reasoning = 'The memo fulfils the spec: grounded findings, three anomalies, clear recommendations.'
    expect(reasonHashOf(reasoning)).toBe(keccak256(toHex(reasoning)))
    expect(reasonHashOf(reasoning)).not.toBe(reasonHashOf(reasoning + ' '))
  })
})

describe('judge JSON parsing (strict — malformed means NO verdict)', () => {
  const valid = {
    rubric: [
      { criterion: 'Spec compliance', score: 9, max: 10, comment: 'Covers every requested section.' },
      { criterion: 'Grounding in the dataset', score: 8, max: 10, comment: 'Cites concrete wallets.' },
    ],
    pass: true,
    reasoning: 'The deliverable substantially fulfils the spec with grounded findings.',
  }

  it('parses clean JSON', () => {
    const v = parseJudgeJson(JSON.stringify(valid))
    expect(v.pass).toBe(true)
    expect(v.rubric).toHaveLength(2)
    expect(v.reasoning).toContain('substantially fulfils')
  })

  it('parses JSON wrapped in fences or prose', () => {
    const v = parseJudgeJson('Here is my evaluation:\n```json\n' + JSON.stringify(valid) + '\n```\nDone.')
    expect(v.pass).toBe(true)
  })

  it('clamps out-of-range scores into [0, max]', () => {
    const v = parseJudgeJson(JSON.stringify({ ...valid, rubric: [{ criterion: 'X', score: 14, max: 10, comment: '' }] }))
    expect(v.rubric[0].score).toBe(10)
  })

  it('throws on garbage, missing pass, missing reasoning, empty rubric', () => {
    expect(() => parseJudgeJson('the deliverable is fine')).toThrow()
    expect(() => parseJudgeJson(JSON.stringify({ ...valid, pass: 'yes' }))).toThrow()
    expect(() => parseJudgeJson(JSON.stringify({ ...valid, reasoning: '' }))).toThrow()
    expect(() => parseJudgeJson(JSON.stringify({ ...valid, rubric: [] }))).toThrow()
  })
})

describe('$0 guarantee — no key means loud failure, never fabrication', () => {
  it('llmKeyPresent is false without a key', () => {
    delete process.env.LLM_API_KEY
    expect(llmKeyPresent()).toBe(false)
  })

  it('agentWriteMemo rejects without a key instead of inventing output', async () => {
    delete process.env.LLM_API_KEY
    await expect(agentWriteMemo('Write a memo.', false)).rejects.toThrow(/LLM_API_KEY missing/)
  })
})
