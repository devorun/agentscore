// Lean chain reads, shared by the settlement cron and the reputation API.
// Both run on the Workers free plan (10 ms of CPU per invocation); on a cold
// isolate viem's client machinery — transport, retries, multicall batching,
// ABI codec — cost more CPU than the reads themselves. These go over plain
// fetch with hand-coded calldata and results, pinned against viem in tests.
import { hexToString, keccak256, toHex, type Address, type Hex } from 'viem'

export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const

/** Function selector, computed once at startup (not per request). */
export const selector = (signature: string) => keccak256(toHex(signature)).slice(0, 10) as Hex
const AGGREGATE3_SELECTOR = selector('aggregate3((address,bool,bytes)[])')
export const GET_JOB_SELECTOR = selector('getJob(uint256)')

/** One JSON-RPC call; throws on an RPC error (callers decide what that means). */
export async function rpcOnce<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const body = (await res.json().catch(() => ({}))) as { result?: T; error?: { message?: string } }
  if (body.result === undefined) throw new Error(`${method}: ${body.error?.message ?? `HTTP ${res.status}`}`)
  return body.result
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A read with a light retry: public endpoints rate-limit shared Workers IPs, so
 * try the primary twice (backing off — waiting costs no CPU), then the last
 * (fallback) endpoint once. An execution revert is final and never retried. */
export async function rpc<T>(urls: readonly string[], method: string, params: unknown[]): Promise<T> {
  const plan = [urls[0], urls[0], urls[urls.length - 1]]
  let last: unknown
  for (let i = 0; i < plan.length; i++) {
    try {
      return await rpcOnce<T>(plan[i], method, params)
    } catch (e) {
      last = e
      if (/revert/i.test(String((e as Error).message))) break
      if (i < plan.length - 1) await pause(300 * (i + 1))
    }
  }
  throw last
}

export const word = (hex: string, i: number) => hex.slice(2 + i * 64, 66 + i * 64)
export const uint = (w: string) => BigInt(`0x${w || '0'}`)
const hexWord = (n: number) => n.toString(16).padStart(64, '0')

/** Calldata for Multicall3.aggregate3(Call3[]) with allowFailure on every call:
 * array offset, length, one offset per element, then each element's
 * (target, allowFailure, bytes offset, bytes length, padded bytes). */
export function encodeAggregate3(calls: { target: Address; callData: Hex }[]): Hex {
  const elements = calls.map((c) => {
    const body = c.callData.slice(2)
    const padded = body.padEnd(Math.ceil(body.length / 64) * 64, '0')
    return c.target.slice(2).toLowerCase().padStart(64, '0') + hexWord(1) + hexWord(96) + hexWord(body.length / 2) + padded
  })
  let offsets = ''
  let at = calls.length * 32
  for (const e of elements) {
    offsets += hexWord(at)
    at += e.length / 2
  }
  return `${AGGREGATE3_SELECTOR}${hexWord(32)}${hexWord(calls.length)}${offsets}${elements.join('')}` as Hex
}

/** Multicall3.aggregate3 with allowFailure: one eth_call for many reads.
 * Returns each call's returnData, or undefined where the call failed. */
export async function aggregate3(urls: readonly string[], calls: { target: Address; callData: Hex }[]): Promise<(Hex | undefined)[]> {
  if (calls.length === 0) return []
  const raw = await rpc<Hex>(urls, 'eth_call', [{ to: MULTICALL3, data: encodeAggregate3(calls) }, 'latest'])
  // Result[] (bool success, bytes returnData): array offset, length, then one
  // offset per element (relative to the element-offset area).
  const at = Number(uint(word(raw, 0))) / 32
  const n = Number(uint(word(raw, at)))
  const out: (Hex | undefined)[] = []
  for (let k = 0; k < n; k++) {
    const el = at + 1 + Number(uint(word(raw, at + 1 + k))) / 32
    const ok = uint(word(raw, el)) === 1n
    const bytesAt = el + Number(uint(word(raw, el + 1))) / 32
    const len = Number(uint(word(raw, bytesAt)))
    out.push(ok ? (`0x${raw.slice(2 + (bytesAt + 1) * 64, 2 + (bytesAt + 1) * 64 + len * 2)}` as Hex) : undefined)
  }
  return out
}

export interface JobView {
  id: bigint
  client: Address
  provider: Address
  evaluator: Address
  description: string
  budget: bigint
  expiredAt: bigint
  status: number
}

/** getJob's return value — one dynamic tuple: (id, client, provider, evaluator,
 * description, budget, expiredAt, status, hook). Addresses come back
 * lowercase; compare against lowercase constants. */
export function decodeJob(data: Hex | undefined): JobView | undefined {
  if (!data || data.length < 2 + 11 * 64) return undefined
  const base = Number(uint(word(data, 0))) / 32
  const f = (k: number) => word(data, base + k)
  const addr = (k: number) => `0x${f(k).slice(24)}` as Address
  const descAt = base + Number(uint(f(4))) / 32
  const descLen = Number(uint(word(data, descAt)))
  const descHex = data.slice(2 + (descAt + 1) * 64, 2 + (descAt + 1) * 64 + descLen * 2)
  return {
    id: uint(f(0)),
    client: addr(1),
    provider: addr(2),
    evaluator: addr(3),
    description: hexToString(`0x${descHex}`),
    budget: uint(f(5)),
    expiredAt: uint(f(6)),
    status: Number(uint(f(7))),
  }
}

/** getJob calldata for a job id. */
export const getJobCall = (jobId: bigint) => `${GET_JOB_SELECTOR}${jobId.toString(16).padStart(64, '0')}` as Hex
