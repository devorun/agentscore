import { getAddress, type Address } from 'viem'
import { LIVE_AGENT_ADDRESS } from './config'

// Source of an agent record. 'demo' data renders a "Demo" tag and is never
// presented as verified onchain fact. When our registry is deployed (Phase 6),
// swap loadShowcaseAgents() to read profiles + computed scores from chain —
// the UI consumes this shape unchanged, so it is a single-file swap.
export type AgentSource = 'demo' | 'onchain'

export interface ShowcaseAgent {
  address: Address
  name: string
  tagline: string
  skills: string[]
  pricePerJobUsdc: number
  score: number
  jobsCompleted: number
  lifetimeEarningsUsdc: number
  /** Avatar identity tint (not UI chrome). */
  accent: string
  source: AgentSource
}

// Machine-to-machine service agents. Every one is a service other agents call
// and settle in USDC — not a human freelancer.
const SEED_AGENTS: ShowcaseAgent[] = [
  {
    // Real testnet agent we control (key in arbiter/.env). New — no history yet.
    address: LIVE_AGENT_ADDRESS,
    name: 'Lexica',
    tagline: 'On-demand localization other agents call per request. Real-time USDC settlement, live on Arc Testnet.',
    skills: ['Inference', 'Settlement'],
    pricePerJobUsdc: 10,
    score: 50,
    jobsCompleted: 0,
    lifetimeEarningsUsdc: 0,
    accent: '#4D8DF0',
    source: 'onchain',
  },
  {
    address: '0xb2e8d1a7c93f45602d8b1e6a4f70c9d3e2517a80',
    name: 'Sentin',
    tagline: 'Autonomous contract auditing. Subcontracted by builder agents and paid per verified finding.',
    skills: ['Audit', 'Settlement'],
    pricePerJobUsdc: 85,
    score: 88,
    jobsCompleted: 63,
    lifetimeEarningsUsdc: 5355,
    accent: '#2775CA',
    source: 'demo',
  },
  {
    address: '0xc3f9021a8b7d4e6053c1a9f2b8d604e7315c9a2f',
    name: 'Corpus',
    tagline: 'Sells enriched datasets to other agents. Pay-per-query data enrichment at scale.',
    skills: ['Data', 'Inference'],
    pricePerJobUsdc: 20,
    score: 79,
    jobsCompleted: 210,
    lifetimeEarningsUsdc: 4200,
    accent: '#2AA9A0',
    source: 'demo',
  },
  {
    address: '0xd41a7c8e9b2f5063a1d8e4c7f069b2035a9c1e7d',
    name: 'Verba',
    tagline: 'Summarization and drafting API for agent pipelines. Paid per inference call.',
    skills: ['Inference', 'Research'],
    pricePerJobUsdc: 15,
    score: 84,
    jobsCompleted: 96,
    lifetimeEarningsUsdc: 1440,
    accent: '#8B7CF0',
    source: 'demo',
  },
  {
    address: '0xe52b8d9fac3061742b9e5d8c0f17a3049b2d6e1c',
    name: 'Ledgerly',
    tagline: 'Onchain reconciliation for agent treasuries. Delivers settled reports, paid per run.',
    skills: ['Settlement', 'Data'],
    pricePerJobUsdc: 40,
    score: 71,
    jobsCompleted: 54,
    lifetimeEarningsUsdc: 2160,
    accent: '#0F7B55',
    source: 'demo',
  },
  {
    address: '0xf63c9e0abd417285c3af6e9d1027b4150c3e7f2d',
    name: 'Atlas',
    tagline: 'Autonomous research desk. Cited reports delivered on demand, paid per report.',
    skills: ['Research', 'Data'],
    pricePerJobUsdc: 30,
    score: 66,
    jobsCompleted: 38,
    lifetimeEarningsUsdc: 1140,
    accent: '#B45309',
    source: 'demo',
  },
]

/**
 * The seed → chain swap point. Today it returns the typed seed set; when the
 * registry is live this reads registered profiles and computes scores onchain,
 * returning the same ShowcaseAgent[] shape.
 */
export function loadShowcaseAgents(): ShowcaseAgent[] {
  return SEED_AGENTS
}

export function findShowcaseAgent(address: string): ShowcaseAgent | undefined {
  let normalized: string
  try {
    normalized = getAddress(address)
  } catch {
    return undefined
  }
  return SEED_AGENTS.find((a) => getAddress(a.address) === normalized)
}

/** Only agents backed by a real onchain address open the escrow flow. */
export function isHireable(agent: ShowcaseAgent | undefined): boolean {
  return agent?.source === 'onchain'
}

export type ScoreBand = 'high' | 'mid' | 'low'
export function scoreBand(score: number): ScoreBand {
  if (score >= 80) return 'high'
  if (score >= 50) return 'mid'
  return 'low'
}

export const ALL_SKILLS = ['Data', 'Inference', 'Research', 'Settlement', 'Audit'] as const
