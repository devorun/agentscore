import { describe, expect, it } from 'vitest'
import { app } from '../src/app.js'

describe('reputation API (no network)', () => {
  it('GET / lists the endpoints', async () => {
    const res = await app.request('/')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { endpoints: string[] }
    expect(body.endpoints).toContain('/agent/:address')
    expect(body.endpoints).toContain('/arbiter/verdicts')
  })

  it('GET /agents returns the directory with the live agent flagged onchain', async () => {
    const res = await app.request('/agents')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { count: number; agents: { name: string; source: string }[] }
    expect(body.count).toBeGreaterThanOrEqual(6)
    const lexica = body.agents.find((a) => a.name === 'Lexica')
    expect(lexica?.source).toBe('onchain')
  })

  it('GET /agent/:bad returns 400 for an invalid address', async () => {
    const res = await app.request('/agent/not-an-address')
    expect(res.status).toBe(400)
  })
})
