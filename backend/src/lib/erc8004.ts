// ERC-8004 (Trustless Agents) interop. Our agents hold identities in Arc
// Testnet's official ERC-8004 Identity Registry, each pointing at an agent card
// served by the AgentScore API, and the arbiter posts every new settled
// verdict to the official Reputation Registry as feedback linked to the job.
//
// Addresses: docs.arc.io → References → Contract addresses (ERC-8004, Testnet),
// confirmed on chain (ERC-1967 proxies, getVersion() = "2.0.0", the reputation
// registry's getIdentityRegistry() returns the identity registry below).
//
// Kept dependency-light: the cron worker imports this on its hot path.
import { getAddress, hexToString, keccak256, toHex, type Address, type Hex } from 'viem'

export const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e' as const
export const REPUTATION_REGISTRY = '0x8004B663056A597Dffe9eCcC1965A193B7388713' as const
export const CHAIN_CAIP = 'eip155:5042002' as const
export const AGENT_REGISTRY_ID = `${CHAIN_CAIP}:${IDENTITY_REGISTRY}` as const

export const APP_URL = 'https://agentscore-app.pages.dev'
export const API_URL = 'https://agentscore-api.devorun.workers.dev'
const ERC8183 = '0x0747EEf0706327138c69792bF28Cd525089e4583' as const
const AGENTSCORE_REGISTRY = '0x1489b56AaE4BB63e9793a151C12964B19bC99d38' as const

/** Feedback tags: tag1 groups AgentScore verdicts (indexed by the registry, so
 * getSummary(agentId, [arbiter], FEEDBACK_TAG, '') aggregates them); tag2 is the
 * outcome. The job itself is linked through `endpoint` and the feedback file. */
export const FEEDBACK_TAG = 'agentscore-verdict'

export interface AgentProfile {
  address: Address
  name: string
  description: string
  skills: string[]
  /** ERC-8004 agentId in the Identity Registry, once registered. */
  erc8004Id?: number
}

/** Our onchain agents — each registered with its own key (the Circle-signed one
 * through its Circle developer-controlled wallet). Public data only. */
export const AGENT_PROFILES: AgentProfile[] = [
  {
    address: '0x939ABdD89fE9C5aAC54615f56c50901acf5E6918',
    name: 'Lexica',
    erc8004Id: 897254,
    description:
      'Data-enrichment agent: dedupes and risk-labels wallet datasets, paid per ERC-8183 job in USDC on Arc. Every delivery is re-derived and verified by the AgentScore arbiter before payment releases.',
    skills: ['data-enrichment', 'risk-labeling', 'erc8183-provider'],
  },
  {
    address: '0xC5143cCdF93A90eC0D2e30A62F36E36D4CB0Ef2c',
    name: 'Lexica Circle',
    erc8004Id: 897255,
    description:
      'Lexica\'s enrichment service signing through a Circle developer-controlled wallet (Circle custodies the key). Same work, same arbiter verification, separate onchain reputation.',
    skills: ['data-enrichment', 'circle-wallets', 'erc8183-provider'],
  },
  {
    address: '0x5eA81E8823E6e50c6D1A4a087fc93d58D40545cC',
    name: 'Prime',
    erc8004Id: 897256,
    description:
      'Prime-contractor agent: takes enrichment jobs, subcontracts parts to specialist agents and pays them from its own earnings. Earned credit-tier terms through its AgentScore history.',
    skills: ['data-enrichment', 'subcontracting', 'erc8183-provider'],
  },
  {
    address: '0x69E1244Bf59Bd091DeB3b0932172e798C16c5c5b',
    name: 'Mallory',
    erc8004Id: 897257,
    description:
      'Adversarial test agent: deliberately submits tampered deliverables so the arbiter\'s reject, refund and collateral-slash paths stay provable onchain. Do not hire.',
    skills: ['adversarial-test'],
  },
]

export function profileOf(address: string): AgentProfile | undefined {
  const a = address.toLowerCase()
  return AGENT_PROFILES.find((p) => p.address.toLowerCase() === a)
}

export const profileUrl = (address: string) => `${APP_URL}/agent/${getAddress(address)}`
export const cardUrl = (address: string) => `${API_URL}/agent/${getAddress(address)}/card.json`
export const jobUrl = (jobId: bigint | string) => `${APP_URL}/job/${jobId}`
export const feedbackUrl = (jobId: bigint | string) => `${API_URL}/erc8004/feedback/${jobId}`
export const identityTokenUrl = (agentId: number) => `https://testnet.arcscan.app/token/${IDENTITY_REGISTRY}/instance/${agentId}`

/** ERC-8004 agent registration file ("agent card"), served at cardUrl(). */
export function agentCard(p: AgentProfile) {
  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: p.name,
    description: p.description,
    image: `${APP_URL}/favicon.svg`,
    services: [
      { name: 'web', endpoint: profileUrl(p.address) },
      { name: 'agentscore-reputation', endpoint: `${API_URL}/agent/${getAddress(p.address)}` },
    ],
    x402Support: false,
    active: true,
    registrations: p.erc8004Id === undefined ? [] : [{ agentId: p.erc8004Id, agentRegistry: AGENT_REGISTRY_ID }],
    supportedTrust: ['reputation'],
    agentscore: { registry: `${CHAIN_CAIP}:${AGENTSCORE_REGISTRY}`, skills: p.skills },
  }
}

export interface VerdictFeedback {
  agentId: number
  jobId: bigint
  completed: boolean
  /** The reason the settlement committed on chain (JobCompleted/JobRejected). */
  reason: Hex
  arbiter: Address
  /** Settlement block timestamp, unix seconds. */
  settledAt: number
}

/** Off-chain feedback file (ERC-8004 format). Deterministic: the cron worker
 * hashes it into feedbackHash when posting, and the API rebuilds and serves the
 * identical bytes at feedbackUrl(), so anyone can check the hash. */
export function feedbackFileJson(f: VerdictFeedback): string {
  return JSON.stringify({
    agentRegistry: AGENT_REGISTRY_ID,
    agentId: f.agentId,
    clientAddress: `${CHAIN_CAIP}:${getAddress(f.arbiter)}`,
    createdAt: new Date(f.settledAt * 1000).toISOString(),
    value: f.completed ? 100 : 0,
    valueDecimals: 0,
    tag1: FEEDBACK_TAG,
    tag2: f.completed ? 'completed' : 'rejected',
    endpoint: jobUrl(f.jobId),
    erc8183: { contract: `${CHAIN_CAIP}:${ERC8183}`, jobId: f.jobId.toString(), settlementReason: f.reason },
  })
}

/** giveFeedback(agentId, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash) */
export function feedbackArgs(f: VerdictFeedback) {
  return [
    BigInt(f.agentId),
    f.completed ? 100n : 0n,
    0,
    FEEDBACK_TAG,
    f.completed ? 'completed' : 'rejected',
    jobUrl(f.jobId),
    feedbackUrl(f.jobId),
    keccak256(toHex(feedbackFileJson(f))),
  ] as const
}

/** The `endpoint` string of a NewFeedback log. Non-indexed data words:
 * feedbackIndex, value, valueDecimals, then the offsets of tag1, tag2,
 * endpoint (word 5) and feedbackURI, then feedbackHash. */
export function feedbackEndpoint(data: Hex): string {
  const wordAt = (i: number) => BigInt(`0x${data.slice(2 + i * 64, 66 + i * 64) || '0'}`)
  const at = 2 + Number(wordAt(5)) * 2
  const len = Number(BigInt(`0x${data.slice(at, at + 64) || '0'}`))
  return hexToString(`0x${data.slice(at + 64, at + 64 + len * 2)}`)
}
