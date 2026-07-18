import { describe, expect, it } from 'vitest'
import { isLlmEnabled, translate } from '../src/lib/llm.js'

describe('optional LLM mode (default $0, no key required)', () => {
  it('is disabled without a key', () => {
    delete process.env.LLM_API_KEY
    expect(isLlmEnabled()).toBe(false)
  })

  it('falls back to a deterministic, offline result with no key', async () => {
    delete process.env.LLM_API_KEY
    const out = await translate('hello', ['fr', 'de'])
    expect(out.mode).toBe('deterministic')
    expect(out.result.fr).toContain('[deterministic:fr]')
    expect(out.result.de).toContain('[deterministic:de]')
  })
})
