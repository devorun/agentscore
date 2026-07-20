// THROWAWAY Phase 1 CPU probe — measures whether real Arc signing fits the
// Workers free plan's 10 ms CPU budget before we re-architect the settlement
// worker for Cloudflare Cron. Signs 1-2 INERT transactions (USDC approve of
// 1 then 0 wei to the reference contract — changes nothing, costs only testnet
// gas) from the THROWAWAY prime demo agent (no roles, not in any live flow).
// The key reaches Cloudflare only via `wrangler secret put`. Parked (cron
// removed) immediately after measurement. Wall-clock segments are reported by
// the probe itself; authoritative CPU time comes from the platform (tail/logs),
// since Workers freeze clocks between I/O boundaries.
import { createPublicClient, createWalletClient, http, keccak256, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

/** Calibrated CPU burner: N chained keccak256 hashes (pure compute, no I/O).
 * Used to locate the enforcement threshold — headroom is measured in the ratio
 * of hashes that survive alongside real work vs. hashes alone. */
function burnHashes(n: number): `0x${string}` {
  let h: `0x${string}` = '0x0000000000000000000000000000000000000000000000000000000000000001'
  for (let i = 0; i < n; i++) h = keccak256(h)
  return h
}

interface Env {
  ARC_RPC: string
  PROBE_PRIVATE_KEY: string
}

const ERC8183 = '0x0747EEf0706327138c69792bF28Cd525089e4583' as const
const USDC = '0x3600000000000000000000000000000000000000' as const
const usdcAbi = parseAbi(['function approve(address spender, uint256 amount) returns (bool)'])
const erc8183Abi = parseAbi([
  'function jobCounter() view returns (uint256)',
  'function getJob(uint256 jobId) view returns ((uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook))',
])

function arcChain(rpc: string) {
  return {
    id: 5042002,
    name: 'Arc Testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  } as const
}

interface ProbeResult {
  ok: boolean
  actions: number
  txs: string[]
  wallMsSegments: Record<string, number>
  totalWallMs: number
}

/** One representative settlement tick: read state, decide, sign + send + confirm. */
async function runProbe(env: Env, actions: number): Promise<ProbeResult> {
  const chain = arcChain(env.ARC_RPC)
  const marks: Record<string, number> = {}
  const t0 = Date.now()
  let last = t0
  const mark = (k: string) => {
    const n = Date.now()
    marks[k] = n - last
    last = n
  }

  const account = privateKeyToAccount(env.PROBE_PRIVATE_KEY as `0x${string}`)
  const pub = createPublicClient({ chain, transport: http(env.ARC_RPC) })
  const wallet = createWalletClient({ account, chain, transport: http(env.ARC_RPC) })
  mark('setup')

  // Representative reads (what the real worker does before acting).
  const counter = (await pub.readContract({ address: ERC8183, abi: erc8183Abi, functionName: 'jobCounter' })) as bigint
  mark('read_jobCounter')
  await pub.readContract({ address: ERC8183, abi: erc8183Abi, functionName: 'getJob', args: [counter - 1n] })
  mark('read_getJob')
  const nonce = await pub.getTransactionCount({ address: account.address })
  mark('read_nonce')

  const txs: string[] = []
  for (let i = 0; i < actions; i++) {
    // Inert: approve(reference, 1) then approve(reference, 0). Full real path —
    // gas estimation, fee fetch, ECDSA sign, RLP serialize, broadcast.
    const hash = await wallet.writeContract({
      address: USDC,
      abi: usdcAbi,
      functionName: 'approve',
      args: [ERC8183, BigInt(1 - i)],
      nonce: nonce + i,
      chain,
    })
    txs.push(hash)
    mark(`sign_send_${i + 1}`)
    await pub.waitForTransactionReceipt({ hash })
    mark(`receipt_${i + 1}`)
  }

  return { ok: true, actions, txs, wallMsSegments: marks, totalWallMs: Date.now() - t0 }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export default {
  async fetch(req: { url: string }, env: Env): Promise<Response> {
    const params = new URL(req.url).searchParams
    try {
      // Pure-compute budget ruler: no network, just N hashes.
      const burnOnly = params.get('burnonly')
      if (burnOnly) {
        const n = Math.min(2_000_000, Number(burnOnly) || 0)
        const h = burnHashes(n)
        return json({ ok: true, mode: 'burnonly', n, tail: h.slice(0, 10) })
      }
      // Real work + N extra hashes: how much compute survives beside signing.
      const burn = params.get('burn')
      if (burn) {
        const n = Math.min(2_000_000, Number(burn) || 0)
        const r = await runProbe(env, 2)
        const h = burnHashes(n)
        return json({ ok: true, mode: 'burn+2actions', n, tail: h.slice(0, 10), totalWallMs: r.totalWallMs })
      }
      const actions = params.get('actions') === '2' ? 2 : 1
      return json(await runProbe(env, actions))
    } catch (e) {
      return json({ ok: false, error: String((e as Error).message ?? e).slice(0, 300) }, 500)
    }
  },
  // The measurement that matters: the same work from a real cron invocation.
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    try {
      const r = await runProbe(env, 2)
      console.log('cron-probe ok', JSON.stringify({ actions: r.actions, totalWallMs: r.totalWallMs, txs: r.txs }))
    } catch (e) {
      console.log('cron-probe FAILED', String((e as Error).message ?? e).slice(0, 300))
    }
  },
}
