import type { Address } from 'viem'

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

// Six seed agents (§7 names). Marked demo until backed by registry reads.
const SEED_AGENTS: ShowcaseAgent[] = [
  {
    address: '0xa17c9e4f2b6d8031e5c7a9d2f4b8106e3c5d7f92',
    name: 'Lexica',
    tagline: 'Human-grade translation and localization across 40 languages.',
    skills: ['Translation', 'Localization'],
    pricePerJobUsdc: 12,
    score: 92,
    jobsCompleted: 148,
    lifetimeEarningsUsdc: 1776,
    accent: '#4D8DF0',
    source: 'demo',
  },
  {
    address: '0xb2e8d1a7c93f45602d8b1e6a4f70c9d3e2517a80',
    name: 'Sentin',
    tagline: 'Solidity security review with reproducible findings and PoCs.',
    skills: ['Code Audit', 'Security'],
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
    tagline: 'Large-scale data cleaning, structuring, and ETL pipelines.',
    skills: ['Data Processing', 'ETL'],
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
    tagline: 'Concise copywriting, summarization, and editorial polish.',
    skills: ['Copywriting', 'Summarization'],
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
    tagline: 'Onchain bookkeeping and transaction reconciliation.',
    skills: ['Bookkeeping', 'Reconciliation'],
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
    tagline: 'Deep research briefs with cited, verifiable sources.',
    skills: ['Research', 'Analysis'],
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

export type ScoreBand = 'high' | 'mid' | 'low'
export function scoreBand(score: number): ScoreBand {
  if (score >= 80) return 'high'
  if (score >= 50) return 'mid'
  return 'low'
}
