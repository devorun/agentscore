import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, keccak256, toHex, type Hex } from 'viem'
import { app } from '../src/app.js'
import {
  AGENT_PROFILES,
  AGENT_REGISTRY_ID,
  agentCard,
  cardUrl,
  feedbackArgs,
  feedbackEndpoint,
  feedbackFileJson,
  feedbackUrl,
  FEEDBACK_TAG,
  IDENTITY_REGISTRY,
  jobUrl,
  profileOf,
  type VerdictFeedback,
} from '../src/lib/erc8004.js'

const ARBITER = '0x5d474e5125D7ee1a63EE2f2444a88e2a518683E9'
const verdict: VerdictFeedback = {
  agentId: 897254,
  jobId: 186950n,
  completed: true,
  reason: keccak256(toHex('agentscore:verified:job-186950')),
  arbiter: ARBITER,
  settledAt: 1791805130,
}

describe('ERC-8004 identity', () => {
  it('uses the official Arc Testnet Identity Registry', () => {
    expect(IDENTITY_REGISTRY).toBe('0x8004A818BFB912233c491871b3d84c89A494BD9e')
    expect(AGENT_REGISTRY_ID).toBe('eip155:5042002:0x8004A818BFB912233c491871b3d84c89A494BD9e')
  })

  it('every profile fits AgentScoreRegistry limits and has a unique agentId', () => {
    const bytes = (s: string) => new TextEncoder().encode(s).length
    for (const p of AGENT_PROFILES) {
      expect(bytes(p.name)).toBeGreaterThanOrEqual(3)
      expect(bytes(p.name)).toBeLessThanOrEqual(32)
      expect(p.skills.length).toBeLessThanOrEqual(10)
      for (const t of p.skills) expect(bytes(t)).toBeLessThanOrEqual(32)
      expect(bytes(cardUrl(p.address))).toBeLessThanOrEqual(200)
      expect(p.erc8004Id).toBeTypeOf('number')
    }
    expect(new Set(AGENT_PROFILES.map((p) => p.erc8004Id)).size).toBe(AGENT_PROFILES.length)
  })

  it('agent card is an ERC-8004 registration file pointing at the AgentScore profile', () => {
    const lexica = profileOf('0x939abdd89fe9c5aac54615f56c50901acf5e6918')!
    const card = agentCard(lexica)
    expect(card.type).toBe('https://eips.ethereum.org/EIPS/eip-8004#registration-v1')
    expect(card.name).toBe('Lexica')
    expect(card.services[0]).toEqual({ name: 'web', endpoint: 'https://agentscore-app.pages.dev/agent/0x939ABdD89fE9C5aAC54615f56c50901acf5E6918' })
    expect(card.registrations).toEqual([{ agentId: 897254, agentRegistry: AGENT_REGISTRY_ID }])
    expect(card.supportedTrust).toContain('reputation')
  })
})

describe('ERC-8004 verdict feedback', () => {
  it('links the job and hashes the exact feedback file', () => {
    const args = feedbackArgs(verdict)
    expect(args[0]).toBe(897254n)
    expect(args[1]).toBe(100n)
    expect(args[2]).toBe(0)
    expect(args[3]).toBe(FEEDBACK_TAG)
    expect(args[4]).toBe('completed')
    expect(args[5]).toBe(jobUrl(186950n))
    expect(args[6]).toBe(feedbackUrl(186950n))
    expect(args[7]).toBe(keccak256(toHex(feedbackFileJson(verdict))))
  })

  it('a rejection scores 0 and is tagged rejected', () => {
    const args = feedbackArgs({ ...verdict, completed: false })
    expect(args[1]).toBe(0n)
    expect(args[4]).toBe('rejected')
  })

  it('the feedback file is deterministic and carries the ERC-8004 required fields', () => {
    const a = feedbackFileJson(verdict)
    expect(feedbackFileJson({ ...verdict })).toBe(a)
    const f = JSON.parse(a)
    expect(f).toMatchObject({
      agentRegistry: AGENT_REGISTRY_ID,
      agentId: 897254,
      clientAddress: `eip155:5042002:${ARBITER}`,
      createdAt: '2026-10-12T11:38:50.000Z',
      value: 100,
      valueDecimals: 0,
      erc8183: { jobId: '186950', settlementReason: verdict.reason },
    })
  })

  it('reads the job endpoint back out of a NewFeedback log', () => {
    const data = encodeAbiParameters(
      [
        { type: 'uint64' },
        { type: 'int128' },
        { type: 'uint8' },
        { type: 'string' },
        { type: 'string' },
        { type: 'string' },
        { type: 'string' },
        { type: 'bytes32' },
      ],
      [7n, 100n, 0, FEEDBACK_TAG, 'completed', jobUrl(186950n), feedbackUrl(186950n), keccak256('0x01') as Hex],
    )
    expect(feedbackEndpoint(data)).toBe(jobUrl(186950n))
  })
})

describe('ERC-8004 API routes (no network)', () => {
  it('serves the agent card for a registered agent', async () => {
    const res = await app.request('/agent/0x939ABdD89fE9C5aAC54615f56c50901acf5E6918/card.json')
    expect(res.status).toBe(200)
    const card = (await res.json()) as { registrations: { agentId: number }[] }
    expect(card.registrations[0].agentId).toBe(897254)
  })

  it('404s a card for an unknown address', async () => {
    const res = await app.request('/agent/0x0000000000000000000000000000000000000001/card.json')
    expect(res.status).toBe(404)
  })

  it('rejects a non-numeric feedback job id', async () => {
    const res = await app.request('/erc8004/feedback/abc')
    expect(res.status).toBe(400)
  })
})
