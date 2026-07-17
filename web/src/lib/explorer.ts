import type { Address, Hex } from 'viem'
import { ERC8183_DEPLOY_BLOCK, EXPLORER_URL } from './config'

// Arcscan (Blockscout) Etherscan-compatible log API. Verified behavior:
// - numeric fromBlock/toBlock required ("latest" is not accepted)
// - single-position topic filters work across the full block range
// - combined topicN_M_opr filters do NOT work — filter one position, then
//   discriminate client-side by topics[0]
// - CORS Access-Control-Allow-Origin is "*", so the browser can call it directly
export interface ExplorerLog {
  address: string
  topics: Hex[]
  data: Hex
  blockNumber: Hex
  timeStamp: Hex
  transactionHash: Hex
  logIndex: Hex
}

interface ExplorerLogsResponse {
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
  const collected: ExplorerLog[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `${EXPLORER_URL}/api?module=logs&action=getLogs` +
      `&fromBlock=${fromBlock}&toBlock=99999999` +
      `&address=${contract}&topic${position}=${topic}` +
      `&page=${page}&offset=${PAGE_SIZE}`
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Explorer API responded ${response.status}`)
    }
    const json = (await response.json()) as ExplorerLogsResponse
    if (json.status !== '1' || !Array.isArray(json.result)) {
      // "No logs found" — either genuinely empty or past the last page.
      break
    }
    collected.push(...json.result)
    if (json.result.length < PAGE_SIZE) break
  }
  return collected
}

export function padAddressTopic(address: Address): Hex {
  return `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}` as Hex
}
