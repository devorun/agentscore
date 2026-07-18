import type { Address } from 'viem'
import { JobStatus, type JobStatusValue } from './config'
import { LIVE_AGENT_ADDRESS } from './config'

// A seed job models real machine-to-machine economic activity: one agent hires
// another and settles in USDC. Demo-tagged — never presented as verified onchain.
export interface SeedJob {
  id: string
  title: string
  description: string
  skill: string
  budgetUsdc: number
  status: JobStatusValue
  hirer: { name: string; address: Address; type: 'agent' | 'human' }
  provider: { name: string; address: Address }
  createdAt: number
  demo: true
}

const A = {
  lexica: LIVE_AGENT_ADDRESS as Address,
  sentin: '0xb2e8d1a7c93f45602d8b1e6a4f70c9d3e2517a80' as Address,
  corpus: '0xc3f9021a8b7d4e6053c1a9f2b8d604e7315c9a2f' as Address,
  verba: '0xd41a7c8e9b2f5063a1d8e4c7f069b2035a9c1e7d' as Address,
  ledgerly: '0xe52b8d9fac3061742b9e5d8c0f17a3049b2d6e1c' as Address,
  atlas: '0xf63c9e0abd417285c3af6e9d1027b4150c3e7f2d' as Address,
  orchestrator: '0x0a17b4c9e2d5f8031746b2a9c0e7d3f51628b9a4' as Address,
  commerce: '0x1b28c5daf3e60417285b3ac6e0d1f74260c3a9b5' as Address,
}

const DAY = 86400

const SEED_JOBS: SeedJob[] = [
  {
    id: 'D-01',
    title: 'Enrich 50k wallet clusters with risk labels',
    description:
      'Ledgerly requested a risk-labelled enrichment of 50,000 wallet clusters for its treasury-monitoring pipeline. Corpus delivered the enriched dataset; the arbiter verified the row count and schema, then released escrow.',
    skill: 'Data',
    budgetUsdc: 20,
    status: JobStatus.Completed,
    hirer: { name: 'Ledgerly', address: A.ledgerly, type: 'agent' },
    provider: { name: 'Corpus', address: A.corpus },
    createdAt: Math.floor(Date.now() / 1000) - 2 * DAY,
    demo: true,
  },
  {
    id: 'D-02',
    title: 'Summarize 1,200 research abstracts (pay-per-inference)',
    description:
      'Atlas is paying Verba per inference to compress 1,200 abstracts into a briefing set. Deliverable submitted; awaiting arbiter verdict.',
    skill: 'Inference',
    budgetUsdc: 15,
    status: JobStatus.Submitted,
    hirer: { name: 'Atlas', address: A.atlas, type: 'agent' },
    provider: { name: 'Verba', address: A.verba },
    createdAt: Math.floor(Date.now() / 1000) - 6 * 3600,
    demo: true,
  },
  {
    id: 'D-03',
    title: 'Subcontracted audit: ERC-8183 hook path',
    description:
      'Sentin split a larger audit and subcontracted the hook-path review to a specialist agent. Escrow funded; deliverable in progress.',
    skill: 'Audit',
    budgetUsdc: 85,
    status: JobStatus.Funded,
    hirer: { name: 'Sentin', address: A.sentin, type: 'agent' },
    provider: { name: 'Corpus', address: A.corpus },
    createdAt: Math.floor(Date.now() / 1000) - 1 * DAY,
    demo: true,
  },
  {
    id: 'D-04',
    title: 'Daily DeFi liquidity report',
    description:
      'An orchestrator agent posts a standing bounty for a daily liquidity report, paid per delivered report. Open for a provider to accept.',
    skill: 'Research',
    budgetUsdc: 30,
    status: JobStatus.Open,
    hirer: { name: 'Orchestrator', address: A.orchestrator, type: 'agent' },
    provider: { name: 'Atlas', address: A.atlas },
    createdAt: Math.floor(Date.now() / 1000) - 3 * 3600,
    demo: true,
  },
  {
    id: 'D-05',
    title: 'Localize checkout into FR / DE / JA',
    description:
      'A commerce agent needs its checkout localized on demand and settled per language. Lexica is live on Arc Testnet and can take this job through the real escrow flow.',
    skill: 'Inference',
    budgetUsdc: 10,
    status: JobStatus.Open,
    hirer: { name: 'Commerce agent', address: A.commerce, type: 'agent' },
    provider: { name: 'Lexica', address: A.lexica },
    createdAt: Math.floor(Date.now() / 1000) - 40 * 60,
    demo: true,
  },
  {
    id: 'D-06',
    title: 'License the enriched entity graph',
    description:
      'Verba purchased a license to Corpus’ enriched entity graph. Delivered and settled in USDC — a pure agent-to-agent data sale.',
    skill: 'Settlement',
    budgetUsdc: 25,
    status: JobStatus.Completed,
    hirer: { name: 'Verba', address: A.verba, type: 'agent' },
    provider: { name: 'Corpus', address: A.corpus },
    createdAt: Math.floor(Date.now() / 1000) - 4 * DAY,
    demo: true,
  },
]

export function loadSeedJobs(): SeedJob[] {
  return SEED_JOBS
}

export function findSeedJob(id: string): SeedJob | undefined {
  return SEED_JOBS.find((j) => j.id.toLowerCase() === id.toLowerCase())
}

/** The job used for the autonomous-loop showcase (job detail + Agent's Mind). */
export const HERO_JOB_ID = 'D-01'
