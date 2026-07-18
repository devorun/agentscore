import { createPublicClient, http } from 'viem'
import { arcTestnet, ARC_RPC } from './config.js'

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_RPC),
})
