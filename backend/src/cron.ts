// Always-on settlement worker on Cloudflare Cron (free plan, $0) — the live
// site's Hire flow completes without any local machine running.
//
// Designed for the measured free-tier CPU budget (Phase 1 probe: two signed
// txs use roughly half the enforced budget; enforcement is ADAPTIVE — one
// overrun degrades subsequent invocations — so this worker runs cool):
//   - stateless: every tick re-derives everything from the chain (no KV, no FS)
//   - reads via ONE multicall over the last K jobs + topic-filtered getLogs
//   - RECEIPT-FREE sends with local nonce increments — never polls receipts;
//     the next tick observes the resulting state and retries idempotently
//   - hard cap of MAX_SENDS (2) transactions per tick
//   - [JUDGED] jobs are skipped (they need the LLM + deliverable store — the
//     local worker's feature); deterministic jobs settle fully autonomously
//
// Signing keys reach Cloudflare ONLY via `wrangler secret put` (testnet-only
// keys, never in the repo). Never run the local signing worker (`npm start`)
// while this cron is scheduled — use `npm run api` locally instead.
import { createPublicClient, createWalletClient, getAddress, http, keccak256, toHex, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { erc8183Abi, registryAbi } from './lib/abi.js'
import { ADVANCE_PCT, COLLATERAL_PCT, isCollateralJob, parseTermsMarker, type TermsMarker } from './lib/credit.js'
import { enrich, enrichTampered, hashOutput, verify, type WalletRow } from './lib/enrichment.js'
import { isJudgedJob } from './lib/judged.js'
import inputRows from '../data/input/wallets.json'

interface Env {
  ARC_RPC: string
  AGENT_PRICE_USDC: string
  AGENT_LEXICA_PRIVATE_KEY: string
  ARBITER_PRIVATE_KEY: string
}

const ERC8183 = '0x0747EEf0706327138c69792bF28Cd525089e4583' as const
const REGISTRY = '0x1489b56AaE4BB63e9793a151C12964B19bC99d38' as const
const USDC = '0x3600000000000000000000000000000000000000' as const
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const
const SCAN_JOBS = 20n // how far back from jobCounter each tick looks
const MAX_SENDS = 2 // measured-safe transaction budget per invocation
// Arc RPCs reject eth_getLogs ranges above 10,000 blocks — stay under it. A
// just-submitted job is minutes old, well inside this window.
const LOG_LOOKBACK = 9_000n
const JOB_SUBMITTED_TOPIC = keccak256(toHex('JobSubmitted(uint256,address,bytes32)'))
const TRANSFER_TOPIC = keccak256(toHex('Transfer(address,address,uint256)'))
const topicAddress = (a: string) => `0x${'0'.repeat(24)}${a.slice(2).toLowerCase()}`

const JobStatus = { Open: 0, Funded: 1, Submitted: 2, Completed: 3, Rejected: 4, Expired: 5 } as const

function chainOf(rpc: string) {
  return {
    id: 5042002,
    name: 'Arc Testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    contracts: { multicall3: { address: MULTICALL3 } },
  } as const
}

interface JobView {
  id: bigint
  client: Address
  provider: Address
  evaluator: Address
  description: string
  budget: bigint
  expiredAt: bigint
  status: number
}

interface TickReport {
  head: string
  scanned: number
  sends: { action: string; jobId: string; tx: string }[]
  skipped: string[]
}

/** One settlement tick: read state, perform at most MAX_SENDS transactions. */
export async function tick(env: Env, dryRun: boolean): Promise<TickReport> {
  const chain = chainOf(env.ARC_RPC)
  const pub = createPublicClient({ chain, transport: http(env.ARC_RPC) })
  const agentAccount = privateKeyToAccount(env.AGENT_LEXICA_PRIVATE_KEY as Hex)
  const arbiterAccount = privateKeyToAccount(env.ARBITER_PRIVATE_KEY as Hex)
  const AGENT = getAddress(agentAccount.address)
  const ARBITER = getAddress(arbiterAccount.address)
  const agent = createWalletClient({ account: agentAccount, chain, transport: http(env.ARC_RPC) })
  const arbiter = createWalletClient({ account: arbiterAccount, chain, transport: http(env.ARC_RPC) })
  const price6 = BigInt(Math.round(Number(env.AGENT_PRICE_USDC || '2') * 1e6))

  const report: TickReport = { head: '0', scanned: 0, sends: [], skipped: [] }
  const head = (await pub.readContract({ address: ERC8183, abi: erc8183Abi, functionName: 'jobCounter' })) as bigint
  report.head = head.toString()
  const from = head > SCAN_JOBS ? head - SCAN_JOBS : 0n
  const ids: bigint[] = []
  for (let i = from; i < head; i++) ids.push(i)

  const states = await pub.multicall({
    contracts: ids.map((jobId) => ({ address: ERC8183, abi: erc8183Abi, functionName: 'getJob' as const, args: [jobId] })),
    allowFailure: true,
  })
  report.scanned = ids.length

  // Local nonces, incremented per send — receipts are never awaited.
  const nonces = new Map<Address, number>()
  async function nextNonce(addr: Address): Promise<number> {
    if (!nonces.has(addr)) nonces.set(addr, await pub.getTransactionCount({ address: addr, blockTag: 'pending' }))
    const n = nonces.get(addr) as number
    nonces.set(addr, n + 1)
    return n
  }
  async function send(
    wallet: typeof agent,
    action: string,
    jobId: bigint,
    params: { address: Address; abi: typeof erc8183Abi | typeof registryAbi; functionName: string; args: readonly unknown[] },
  ) {
    if (dryRun) {
      report.sends.push({ action: `DRY:${action}`, jobId: jobId.toString(), tx: '' })
      return
    }
    const nonce = await nextNonce(getAddress(wallet.account.address))
    const tx = await wallet.writeContract({ ...params, nonce, chain } as never)
    report.sends.push({ action, jobId: jobId.toString(), tx })
    console.log(`[cron] ${action} #${jobId} → ${tx}`)
  }

  /** Deliverable hash the provider actually submitted (topic-filtered, tiny).
   * Errors return undefined — the job is skipped this tick, never aborting the
   * whole scan. */
  async function submittedHash(jobId: bigint, blockHead: bigint): Promise<Hex | undefined> {
    try {
      const fromBlock = blockHead > LOG_LOOKBACK ? blockHead - LOG_LOOKBACK : 0n
      const raw = (await pub.request({
        method: 'eth_getLogs',
        params: [
          {
            address: ERC8183,
            topics: [JOB_SUBMITTED_TOPIC, `0x${jobId.toString(16).padStart(64, '0')}`],
            fromBlock: `0x${fromBlock.toString(16)}`,
            toBlock: 'latest',
          },
        ],
      })) as { data: Hex }[]
      const data = raw[0]?.data
      return data && data.length >= 66 ? (data.slice(0, 66) as Hex) : undefined
    } catch {
      return undefined
    }
  }

  /** Credit-terms gate (mirrors the local worker): no work until verified. */
  async function termsSatisfied(job: JobView, terms: TermsMarker): Promise<boolean> {
    if (terms.tier === 'credit') {
      if (!terms.advanceTx) return false
      const rcpt = await pub.getTransactionReceipt({ hash: terms.advanceTx }).catch(() => null)
      const needed = (price6 * BigInt(ADVANCE_PCT)) / 100n
      return Boolean(
        rcpt?.status === 'success' &&
          rcpt.logs.some(
            (l) =>
              getAddress(l.address) === getAddress(USDC) &&
              l.topics[0]?.toLowerCase() === TRANSFER_TOPIC.toLowerCase() &&
              l.topics[1]?.toLowerCase() === topicAddress(job.client) &&
              l.topics[2]?.toLowerCase() === topicAddress(AGENT) &&
              BigInt(l.data) >= needed,
          ),
      )
    }
    if (terms.tier === 'collateral') {
      if (terms.collateralJobId === undefined) return false
      const col = (await pub.readContract({ address: ERC8183, abi: erc8183Abi, functionName: 'getJob', args: [terms.collateralJobId] })) as JobView
      const needed = (price6 * BigInt(COLLATERAL_PCT)) / 100n
      return (
        isCollateralJob(col.description) &&
        getAddress(col.client) === AGENT &&
        getAddress(col.provider) === getAddress(job.client) &&
        getAddress(col.evaluator) === ARBITER &&
        (col.status === JobStatus.Funded || col.status === JobStatus.Submitted) &&
        col.budget >= needed
      )
    }
    return true
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const blockHead = await pub.getBlockNumber()

  for (let i = 0; i < ids.length && report.sends.length < MAX_SENDS; i++) {
    const state = states[i]
    if (state.status !== 'success') continue
    const job = state.result as unknown as JobView
    const jobId = ids[i]
    try {
    if (getAddress(job.provider) !== AGENT || getAddress(job.evaluator) !== ARBITER) continue
    if (isJudgedJob(job.description)) {
      if (job.status !== JobStatus.Completed && job.status !== JobStatus.Rejected) report.skipped.push(`#${jobId} judged (local-worker feature)`)
      continue
    }
    const terms = parseTermsMarker(job.description)

    if (job.status === JobStatus.Open && job.budget === 0n) {
      const escrow6 = terms?.tier === 'credit' ? (price6 * BigInt(100 - ADVANCE_PCT)) / 100n : price6
      await send(agent, 'agent setBudget', jobId, { address: ERC8183, abi: erc8183Abi, functionName: 'setBudget', args: [jobId, escrow6, '0x'] })
    } else if (job.status === JobStatus.Funded) {
      if (terms && !(await termsSatisfied(job, terms))) {
        report.skipped.push(`#${jobId} terms not yet satisfied`)
        continue
      }
      const tamper = /\[bad\]|tamper/i.test(job.description)
      const output = tamper ? enrichTampered(inputRows as WalletRow[]) : enrich(inputRows as WalletRow[])
      await send(agent, `agent submit${tamper ? ' (tampered run)' : ''}`, jobId, {
        address: ERC8183,
        abi: erc8183Abi,
        functionName: 'submit',
        args: [jobId, hashOutput(output), '0x'],
      })
    } else if (job.status === JobStatus.Submitted) {
      if (nowSec >= Number(job.expiredAt)) {
        const reason = keccak256(toHex(`agentscore:rejected-late:job-${jobId}`))
        await send(arbiter, 'arbiter reject (late)', jobId, { address: ERC8183, abi: erc8183Abi, functionName: 'reject', args: [jobId, reason, '0x'] })
        await send(arbiter, 'arbiter attest REJECTED', jobId, { address: REGISTRY, abi: registryAbi, functionName: 'attest', args: [jobId, getAddress(job.provider), 1, reason] })
        continue
      }
      const onchain = await submittedHash(jobId, blockHead)
      if (!onchain) {
        report.skipped.push(`#${jobId} submitted hash not found yet`)
        continue
      }
      // Deterministic verification by re-derivation — no storage needed.
      const result = verify(inputRows as WalletRow[], enrich(inputRows as WalletRow[]), onchain)
      const good = result.ok
      const reason = keccak256(toHex(good ? `agentscore:verified:job-${jobId}` : `agentscore:rejected-badwork:job-${jobId}`))
      await send(arbiter, good ? 'arbiter complete (verified)' : 'arbiter reject (bad work)', jobId, {
        address: ERC8183,
        abi: erc8183Abi,
        functionName: good ? 'complete' : 'reject',
        args: [jobId, reason, '0x'],
      })
      await send(arbiter, `arbiter attest ${good ? 'APPROVED' : 'REJECTED'}`, jobId, {
        address: REGISTRY,
        abi: registryAbi,
        functionName: 'attest',
        args: [jobId, getAddress(job.provider), good ? 0 : 1, reason],
      })
    } else if (job.status === JobStatus.Completed || job.status === JobStatus.Rejected) {
      // Repairs, both idempotent: missing attestation, then linked collateral.
      const attested = (await pub.readContract({ address: REGISTRY, abi: registryAbi, functionName: 'jobAttested', args: [jobId] }).catch(() => true)) as boolean
      if (!attested) {
        const good = job.status === JobStatus.Completed
        const reason = keccak256(toHex(good ? `agentscore:verified:job-${jobId}` : `agentscore:rejected-badwork:job-${jobId}`))
        await send(arbiter, `arbiter attest ${good ? 'APPROVED' : 'REJECTED'} (repair)`, jobId, {
          address: REGISTRY,
          abi: registryAbi,
          functionName: 'attest',
          args: [jobId, getAddress(job.provider), good ? 0 : 1, reason],
        })
        continue
      }
      if (terms?.collateralJobId !== undefined) {
        const col = (await pub.readContract({ address: ERC8183, abi: erc8183Abi, functionName: 'getJob', args: [terms.collateralJobId] })) as JobView
        if ((col.status === JobStatus.Funded || col.status === JobStatus.Submitted) && isCollateralJob(col.description) && getAddress(col.evaluator) === ARBITER) {
          const release = job.status === JobStatus.Completed
          const reason = keccak256(toHex(release ? `Collateral released: main job #${jobId} settled cleanly.` : `Collateral slashed: main job #${jobId} was rejected.`))
          await send(arbiter, release ? 'arbiter release collateral' : 'arbiter slash collateral', terms.collateralJobId, {
            address: ERC8183,
            abi: erc8183Abi,
            functionName: release ? 'reject' : 'complete',
            args: [terms.collateralJobId, reason, '0x'],
          })
        }
      }
    }
    } catch (e) {
      // One job's failure never aborts the tick — skip it, retry next minute.
      report.skipped.push(`#${jobId} error: ${String((e as Error).message ?? e).slice(0, 90)}`)
    }
  }
  return report
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export default {
  // Read-only status view: what the worker sees and WOULD do (no signing).
  async fetch(_req: { url: string }, env: Env): Promise<Response> {
    try {
      return json({ ok: true, worker: 'agentscore-worker (cloud settlement, cron * * * * *)', ...(await tick(env, true)) })
    } catch (e) {
      return json({ ok: false, error: String((e as Error).message ?? e).slice(0, 300) }, 500)
    }
  },
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    try {
      const r = await tick(env, false)
      if (r.sends.length > 0 || r.skipped.length > 0) console.log('[cron] tick', JSON.stringify(r))
    } catch (e) {
      console.log('[cron] tick FAILED', String((e as Error).message ?? e).slice(0, 300))
    }
  },
}
