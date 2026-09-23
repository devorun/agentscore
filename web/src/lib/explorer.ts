import { keccak256, toHex, type Address, type Hex } from 'viem'
import { APPEALS_ADDRESS, ERC8183_ADDRESS, ERC8183_DEPLOY_BLOCK, EXPLORER_URL } from './config'

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

// ---- Chain backfill (mirrors the API) --------------------------------------
// The explorer is only an accelerator for deep history; whatever it has not
// indexed is read straight from chain — one eth_getLogs per ≤5,000-block page
// on the official RPC (which allows this site's origin), both contracts, every
// event scoring reads, in the explorer's log shape.
const LOGS_RPC = 'https://rpc.testnet.arc.network'
const BACKFILL_STEP = 5_000n
const BACKFILL_MAX_PAGES = 40
const topicOf = (signature: string) => keccak256(toHex(signature))
const BACKFILL_TOPICS = [
  topicOf('JobCreated(uint256,address,address,address,uint256,address)'),
  topicOf('PaymentReleased(uint256,address,uint256)'),
  topicOf('JobRejected(uint256,address,bytes32)'),
  topicOf('AppealResolved(uint256,address,uint8,uint8,bool,bytes32,address)'),
]

async function getLogsPage(params: unknown): Promise<(ExplorerLog & { blockTimestamp: Hex })[]> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(LOGS_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [params] }),
    }).catch(() => undefined)
    const json = (await response?.json().catch(() => undefined)) as { result?: (ExplorerLog & { blockTimestamp: Hex })[] } | undefined
    if (json?.result) return json.result
    if (attempt === 2) throw new Error('eth_getLogs failed')
    await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
  }
}

/** Logs in blocks (from, to], read from chain; `upTo` is the last block
 * actually covered (a page that keeps failing stops the backfill there). */
export async function fetchChainLogs(from: bigint, to: bigint): Promise<{ logs: ExplorerLog[]; upTo: bigint }> {
  const logs: ExplorerLog[] = []
  let upTo = from
  for (let page = 0; page < BACKFILL_MAX_PAGES && upTo < to; page++) {
    const start = upTo + 1n
    const end = start + BACKFILL_STEP - 1n < to ? start + BACKFILL_STEP - 1n : to
    let found
    try {
      found = await getLogsPage({ address: [ERC8183_ADDRESS, APPEALS_ADDRESS], topics: [BACKFILL_TOPICS], fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}` })
    } catch {
      break
    }
    for (const l of found) logs.push({ ...l, timeStamp: l.blockTimestamp })
    upTo = end
  }
  return { logs, upTo }
}

/** Explorer logs plus backfilled ones, without double-counting a log both saw. */
export function mergeLogs(a: ExplorerLog[], b: ExplorerLog[]): ExplorerLog[] {
  const index = (h: string) => (h && h !== '0x' ? BigInt(h) : 0n) // Blockscout can send index 0 as "0x"
  const key = (l: ExplorerLog) => `${l.transactionHash.toLowerCase()}:${index(l.logIndex)}`
  const seen = new Set(a.map(key))
  return [...a, ...b.filter((l) => !seen.has(key(l)))]
}

/** The newest block the explorer's log index covers. It can trail the chain —
 * it has stalled for hours — and logs past it are simply absent. */
export async function fetchIndexedHead(): Promise<bigint> {
  const response = await fetch(`${EXPLORER_URL}/api?module=block&action=eth_block_number`)
  if (!response.ok) throw new Error(`Explorer API responded ${response.status}`)
  const json = (await response.json()) as { result?: string }
  if (!json.result) throw new Error('Explorer API returned no indexed head')
  return BigInt(json.result)
}

export function padAddressTopic(address: Address): Hex {
  return `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}` as Hex
}
