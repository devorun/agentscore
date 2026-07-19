import { defineChain } from 'viem'

export const ARC_RPC = process.env.ARC_RPC || 'https://arc-testnet.drpc.org'
export const EXPLORER_URL = 'https://testnet.arcscan.app'

export const ERC8183_ADDRESS = '0x0747EEf0706327138c69792bF28Cd525089e4583' as const
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const
export const USDC_DECIMALS = 6
export const ERC8183_DEPLOY_BLOCK = 33908011n

export const REGISTRY_ADDRESS = (process.env.REGISTRY_ADDRESS ||
  '0x1489b56AaE4BB63e9793a151C12964B19bC99d38') as `0x${string}`
export const ARBITER_ADDRESS = '0x5d474e5125D7ee1a63EE2f2444a88e2a518683E9' as const
export const LIVE_AGENT_ADDRESS = '0x939ABdD89fE9C5aAC54615f56c50901acf5E6918' as const

export const arcTestnet = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC] } },
  blockExplorers: { default: { name: 'Arcscan', url: EXPLORER_URL } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
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

export const PORT = Number(process.env.PORT || 8787)
export const API_ONLY = process.env.API_ONLY === '1' || process.env.API_ONLY === 'true'

// --- Circle Nanopayments (per-row USDC settlement via Circle Gateway) ---------
// Default OFF: the ERC-8183 escrow loop is byte-for-byte unchanged unless this is
// set. When on, the client meters micro-USDC per enriched row over Gateway
// (gasless, off-chain, batched) alongside — never replacing — the escrow.
export const NANOPAY_ENABLED = process.env.NANOPAY_ENABLED === '1' || process.env.NANOPAY_ENABLED === 'true'
export const NANOPAY_PRICE_PER_ROW = process.env.NANOPAY_PRICE_PER_ROW || '0.001'
export const NANOPAY_PORT = Number(process.env.NANOPAY_PORT || 8788)
export const NANOPAY_CHAIN = 'arcTestnet' as const // Circle Gateway chain name
export const ARC_CAIP = 'eip155:5042002' as const // Arc Testnet in CAIP-2
export const GATEWAY_API_TESTNET = 'https://gateway-api-testnet.circle.com' as const
export const DEMO_CLIENT_ADDRESS = process.env.DEMO_CLIENT_ADDRESS || ''
