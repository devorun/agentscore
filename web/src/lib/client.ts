import { type Abi, type Address, type ContractFunctionParameters, createPublicClient, http } from 'viem'
import { arcTestnet, RPC_URL } from './config'

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(RPC_URL, { batch: true }),
  batch: { multicall: { wait: 16 } },
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Reads many contract calls through Multicall3 in a few large sequential chunks,
 * with exponential backoff on failure.
 *
 * The public RPC allows only a short burst before returning HTTP 429 (measured:
 * ~13 requests before throttling). The reliability lever is therefore request
 * *count*, not pacing: collapsing 100 reads into one aggregate3 eth_call keeps a
 * 250-job agent under three requests, well inside the burst budget. Each chunk
 * is one eth_call; a 429 backs off and retries the whole chunk.
 */
export async function readChunked<T>(
  calls: readonly ContractFunctionParameters[],
  { chunkSize = 100, retries = 4 }: { chunkSize?: number; retries?: number } = {},
): Promise<(T | null)[]> {
  const out: (T | null)[] = []
  for (let i = 0; i < calls.length; i += chunkSize) {
    const chunk = calls.slice(i, i + chunkSize)
    let attempt = 0
    // Retry the whole chunk on a transport-level throw (rate limit, timeout).
    for (;;) {
      try {
        const results = await publicClient.multicall({
          contracts: chunk as {
            address: Address
            abi: Abi
            functionName: string
            args?: readonly unknown[]
          }[],
          allowFailure: true,
          // Force the whole chunk into ONE aggregate3 eth_call. viem otherwise
          // sub-splits by a ~1KB calldata budget into several parallel calls,
          // which trip the RPC's 429 burst limit and (under allowFailure) come
          // back as silent nulls. A large budget keeps it to a single request
          // so a 429 throws and our backoff below governs the retry.
          batchSize: 1_048_576,
        })
        for (const r of results) out.push(r.status === 'success' ? (r.result as T) : null)
        break
      } catch {
        if (++attempt > retries) {
          for (let k = 0; k < chunk.length; k++) out.push(null)
          break
        }
        await sleep(500 * 2 ** (attempt - 1)) // 500ms, 1s, 2s, 4s
      }
    }
  }
  return out
}
