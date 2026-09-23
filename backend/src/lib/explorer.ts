import { keccak256, toHex, type Address, type Hex } from 'viem'
import { APPEALS_ADDRESS, ERC8183_ADDRESS, ERC8183_DEPLOY_BLOCK, EXPLORER_URL, LOGS_RPC } from './config.js'
import { rpc } from './lean.js'

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

// ---- Chain backfill ---------------------------------------------------------
// The explorer is only an accelerator for deep history: its index can trail the
// chain by hours (it has stalled). Whatever it has not indexed is read straight
// from chain — one eth_getLogs per ≤5,000-block page on the official RPC
// (dRPC's free plan serves no logs), covering both contracts and every event
// scoring reads, in the explorer's own log shape so callers filter it the same
// way. Measured: < 1 ms of CPU for a 5-page gap; wall time is network.
const BACKFILL_STEP = 5_000n
const BACKFILL_MAX_PAGES = 40 // ≈ 25 h of blocks; beyond that, stop honestly (see upTo)
const topicOf = (signature: string) => keccak256(toHex(signature))
const BACKFILL_TOPICS = [
  topicOf('JobCreated(uint256,address,address,address,uint256,address)'),
  topicOf('PaymentReleased(uint256,address,uint256)'),
  topicOf('JobRejected(uint256,address,bytes32)'),
  topicOf('AppealResolved(uint256,address,uint8,uint8,bool,bytes32,address)'),
]

interface RpcLog {
  address: string
  topics: Hex[]
  data: Hex
  blockNumber: Hex
  blockTimestamp: Hex
  transactionHash: Hex
  logIndex: Hex
}

/** Logs in blocks (from, to], read from chain. `upTo` is the last block
 * actually covered: a page that still fails after retries stops the backfill
 * there, and callers never claim a block past it. */
export async function fetchChainLogs(from: bigint, to: bigint): Promise<{ logs: ExplorerLog[]; upTo: bigint }> {
  const logs: ExplorerLog[] = []
  let upTo = from
  for (let page = 0; page < BACKFILL_MAX_PAGES && upTo < to; page++) {
    const start = upTo + 1n
    const end = start + BACKFILL_STEP - 1n < to ? start + BACKFILL_STEP - 1n : to
    let found: RpcLog[]
    try {
      found = await rpc<RpcLog[]>([LOGS_RPC], 'eth_getLogs', [
        { address: [ERC8183_ADDRESS, APPEALS_ADDRESS], topics: [BACKFILL_TOPICS], fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}` },
      ])
    } catch {
      break
    }
    for (const l of found) {
      logs.push({ address: l.address, topics: l.topics, data: l.data, blockNumber: l.blockNumber, timeStamp: l.blockTimestamp, transactionHash: l.transactionHash, logIndex: l.logIndex })
    }
    upTo = end
  }
  return { logs, upTo }
}

/** Explorer logs plus backfilled ones, without double-counting a log both saw
 * (the explorer can index further while the backfill runs). */
export function mergeLogs(a: ExplorerLog[], b: ExplorerLog[]): ExplorerLog[] {
  const index = (h: string) => (h && h !== '0x' ? BigInt(h) : 0n) // Blockscout can send index 0 as "0x"
  const key = (l: ExplorerLog) => `${l.transactionHash.toLowerCase()}:${index(l.logIndex)}`
  const seen = new Set(a.map(key))
  return [...a, ...b.filter((l) => !seen.has(key(l)))]
}

/** The newest block the explorer's log index covers. It can trail the chain —
 * it has stalled for hours — and logs past it are simply absent. */
export async function fetchIndexedHead(): Promise<bigint> {
  const res = await fetch(`${EXPLORER_URL}/api?module=block&action=eth_block_number`)
  if (!res.ok) throw new Error(`Explorer API ${res.status}`)
  const json = (await res.json()) as { result?: string }
  if (!json.result) throw new Error('Explorer API: no indexed head')
  return BigInt(json.result)
}

export function padAddressTopic(address: Address): Hex {
  return `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}` as Hex
}
