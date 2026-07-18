import { defineChain } from 'viem'

// All values verified against official docs and the live network in Phase 0.
// The official RPC 429s hard under load (measured 3/24 requests OK); dRPC's Arc
// Testnet endpoint handled 24/24 with zero throttling, so reads + wallet use it.
export const RPC_URL = 'https://arc-testnet.drpc.org'
export const RPC_URL_FALLBACK = 'https://5042002.rpc.thirdweb.com'
export const EXPLORER_URL = 'https://testnet.arcscan.app'
export const FAUCET_URL = 'https://faucet.circle.com'

export const ERC8183_ADDRESS = '0x0747EEf0706327138c69792bF28Cd525089e4583' as const
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const
export const ERC8183_DEPLOY_BLOCK = 33908011n

// Our testnet arbiter (evaluator) and the one live agent we control. Public
// addresses only; their private keys live in arbiter/.env (gitignored).
export const ARBITER_ADDRESS = '0x5d474e5125D7ee1a63EE2f2444a88e2a518683E9' as const
export const LIVE_AGENT_ADDRESS = '0x939ABdD89fE9C5aAC54615f56c50901acf5E6918' as const

// ERC-20 USDC uses 6 decimals; native gas USDC uses 18. Never mix them.
export const USDC_DECIMALS = 6

// The public RPC rejects eth_getLogs ranges above 10,000 blocks (error -32614).
export const GETLOGS_MAX_RANGE = 10000n

// Optional backend API base. When set, reputation/jobs reads prefer it and fall
// back to direct chain reads if it is unreachable.
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || undefined

const registryEnv = import.meta.env.VITE_REGISTRY_ADDRESS as string | undefined
export const REGISTRY_ADDRESS =
  registryEnv && registryEnv.length === 42 ? (registryEnv as `0x${string}`) : undefined
const registryBlockEnv = import.meta.env.VITE_REGISTRY_DEPLOY_BLOCK as string | undefined
export const REGISTRY_DEPLOY_BLOCK = registryBlockEnv ? BigInt(registryBlockEnv) : undefined

export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL], webSocket: ['wss://rpc.testnet.arc.network'] },
  },
  blockExplorers: {
    default: { name: 'Arcscan', url: EXPLORER_URL },
  },
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
  testnet: true,
})

export const JobStatus = {
  Open: 0,
  Funded: 1,
  Submitted: 2,
  Completed: 3,
  Rejected: 4,
  Expired: 5,
} as const
export type JobStatusValue = (typeof JobStatus)[keyof typeof JobStatus]
