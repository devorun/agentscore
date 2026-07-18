import type { Address, Hex } from 'viem'
import { ERC8183_DEPLOY_BLOCK, EXPLORER_URL } from './config.js'

// Arcscan (Blockscout) Etherscan-compatible log API: single-position topic
// filters across the full block range, no key required. Used for full-history
// per-address queries (topic-filtered), where a raw RPC getLogs range would be
// too large.
export interface ExplorerLog {
  address: string
  topics: Hex[]
  data: Hex
  blockNumber: Hex
  timeStamp: Hex
  transactionHash: Hex
  logIndex: Hex
}

interface ExplorerResponse {
  status: string
  message: string
  result: ExplorerLog[] | string
}

const PAGE_SIZE = 1000
const MAX_PAGES = 25

export async function fetchLogsByTopic(
  contract: Address,
  position: 1 | 2 | 3,
  topic: Hex,
  fromBlock: bigint = ERC8183_DEPLOY_BLOCK,
): Promise<ExplorerLog[]> {
  const out: ExplorerLog[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `${EXPLORER_URL}/api?module=logs&action=getLogs` +
      `&fromBlock=${fromBlock}&toBlock=99999999&address=${contract}` +
      `&topic${position}=${topic}&page=${page}&offset=${PAGE_SIZE}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Explorer API ${res.status}`)
    const json = (await res.json()) as ExplorerResponse
    if (json.status !== '1' || !Array.isArray(json.result)) break
    out.push(...json.result)
    if (json.result.length < PAGE_SIZE) break
  }
  return out
}

export function padAddressTopic(address: Address): Hex {
  return `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}` as Hex
}
