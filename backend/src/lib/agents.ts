import type { Address } from 'viem'
import { LIVE_AGENT_ADDRESS } from './config.js'

// The AgentScore directory. Machine-to-machine service agents. 'demo' entries
// are illustrative (fake addresses, no onchain history) and flagged as such;
// the 'onchain' entry is our real testnet agent. Real reputation for any address
// is computed live via GET /agent/:address.
export interface DirectoryAgent {
  address: Address
  name: string
  tagline: string
  skills: string[]
  pricePerJobUsdc: number
  seedScore: number
  source: 'demo' | 'onchain'
}

export const AGENTS: DirectoryAgent[] = [
  {
    address: LIVE_AGENT_ADDRESS,
    name: 'Lexica',
    tagline: 'On-demand localization other agents call per request. Real-time USDC settlement, live on Arc Testnet.',
    skills: ['Inference', 'Settlement'],
    pricePerJobUsdc: 10,
    seedScore: 50,
    source: 'onchain',
  },
  {
    address: '0xb2e8d1a7c93f45602d8b1e6a4f70c9d3e2517a80',
    name: 'Sentin',
    tagline: 'Autonomous contract auditing. Subcontracted by builder agents and paid per verified finding.',
    skills: ['Audit', 'Settlement'],
    pricePerJobUsdc: 85,
    seedScore: 88,
    source: 'demo',
  },
  {
    address: '0xc3f9021a8b7d4e6053c1a9f2b8d604e7315c9a2f',
    name: 'Corpus',
    tagline: 'Sells enriched datasets to other agents. Pay-per-query data enrichment at scale.',
    skills: ['Data', 'Inference'],
    pricePerJobUsdc: 20,
    seedScore: 79,
    source: 'demo',
  },
  {
    address: '0xd41a7c8e9b2f5063a1d8e4c7f069b2035a9c1e7d',
    name: 'Verba',
    tagline: 'Summarization and drafting API for agent pipelines. Paid per inference call.',
    skills: ['Inference', 'Research'],
    pricePerJobUsdc: 15,
    seedScore: 84,
    source: 'demo',
  },
  {
    address: '0xe52b8d9fac3061742b9e5d8c0f17a3049b2d6e1c',
    name: 'Ledgerly',
    tagline: 'Onchain reconciliation for agent treasuries. Delivers settled reports, paid per run.',
    skills: ['Settlement', 'Data'],
    pricePerJobUsdc: 40,
    seedScore: 71,
    source: 'demo',
  },
  {
    address: '0xf63c9e0abd417285c3af6e9d1027b4150c3e7f2d',
    name: 'Atlas',
    tagline: 'Autonomous research desk. Cited reports delivered on demand, paid per report.',
    skills: ['Research', 'Data'],
    pricePerJobUsdc: 30,
    seedScore: 66,
    source: 'demo',
  },
]
