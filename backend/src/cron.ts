// Always-on settlement worker on Cloudflare Cron (free plan, $0) — the live
// site's Hire flow completes without any local machine running.
//
// Designed for the free plan's 10 ms CPU budget (enforcement is ADAPTIVE —
// overruns degrade later invocations — so this worker runs cool):
//   - stateless: every tick re-derives everything from the chain (no KV, no FS)
//   - no key material on idle ticks: signer addresses are public config; a tx is
//     signed (small secp256k1 table, raw EIP-1559, no wallet client) only to send
//   - EVENT-based discovery: our agent's jobs come from their JobCreated logs
//     (provider-indexed, a few sequential pages, no in-tick retries), immune to
//     churn on the shared contract; ONE multicall then reads their state
//   - RECEIPT-FREE sends with local nonce increments — never polls receipts;
//     the next tick observes the resulting state and retries idempotently
//   - hard cap of MAX_SENDS (2) transactions per tick
//   - [JUDGED] jobs are skipped (they need the LLM + deliverable store — the
//     local worker's feature); deterministic jobs settle fully autonomously
//
// Signing keys reach Cloudflare ONLY via `wrangler secret put` (testnet-only
// keys, never in the repo). Never run the local signing worker (`npm start`)
// while this cron is scheduled — use `npm run api` locally instead.
import { secp256k1 } from '@noble/curves/secp256k1'
import { createPublicClient, encodeFunctionData, getAddress, http, keccak256, toHex, type Address, type Hex } from 'viem'
import { signTransaction } from 'viem/accounts'
import { erc8183Abi, registryAbi } from './lib/abi.js'
import { ADVANCE_PCT, COLLATERAL_PCT, creditTermsEarned, isCollateralJob, parseTermsMarker, type TermsMarker } from './lib/credit.js'
import { enrich, enrichTampered, hashOutput, verify, type WalletRow } from './lib/enrichment.js'
import { isJudgedJob } from './lib/judged.js'
import { aggregate3, decodeJob, MULTICALL3, rpc, rpcOnce, selector, uint, word, type JobView } from './lib/lean.js'
import { computeReputation } from './lib/reputation.js'
import inputRows from '../data/input/wallets.json'

interface Env {
  ARC_RPC: string
  /** eth_getLogs endpoint — dRPC's free plan no longer serves log queries. */
  LOGS_RPC?: string
  AGENT_PRICE_USDC: string
  AGENT_LEXICA_PRIVATE_KEY: string
  ARBITER_PRIVATE_KEY: string
  /** Public addresses of the two signers, so reads never touch key material. */
  AGENT_ADDRESS?: string
  ARBITER_ADDRESS?: string
  DISCOVERY_PAGES?: string
}

const ERC8183 = '0x0747EEf0706327138c69792bF28Cd525089e4583' as const
const REGISTRY = '0x1489b56AaE4BB63e9793a151C12964B19bC99d38' as const
const USDC = '0x3600000000000000000000000000000000000000' as const
const DEFAULT_AGENT = '0x939ABdD89fE9C5aAC54615f56c50901acf5E6918' as const
const DEFAULT_ARBITER = '0x5d474e5125D7ee1a63EE2f2444a88e2a518683E9' as const
const DEFAULT_LOGS_RPC = 'https://rpc.testnet.arc.network'
const MAX_SENDS = 2 // measured-safe transaction budget per invocation
// eth_getLogs pages: the official RPC serves 5,000-block ranges but throttles
// bursts, so pages run sequentially and a failed page never retries in-tick.
const LOG_STEP = 5_000n
const SUBMITTED_LOOKBACK_PAGES = 4 // ≈ 2.5 h back for a JobSubmitted log
// Default discovery depth: 3 × 5000 blocks ≈ 2 h (Arc blocks run ~0.46 s),
// plus the counter tail below — enough to follow a hire through its life on a
// quiet contract without the tick's CPU growing with history. Override with
// DISCOVERY_PAGES.
const DEFAULT_DISCOVERY_PAGES = 3
const TAIL_JOBS = 20n // counter-based safety net for the newest jobs
const JOB_CREATED_TOPIC = keccak256(toHex('JobCreated(uint256,address,address,address,uint256,address)'))
const JOB_SUBMITTED_TOPIC = keccak256(toHex('JobSubmitted(uint256,address,bytes32)'))
const JOB_COMPLETED_TOPIC = keccak256(toHex('JobCompleted(uint256,address,bytes32)'))
const JOB_REJECTED_TOPIC = keccak256(toHex('JobRejected(uint256,address,bytes32)'))
const TRANSFER_TOPIC = keccak256(toHex('Transfer(address,address,uint256)'))
// Function selectors, computed once at startup (not per tick).
const JOB_COUNTER_CALL = selector('jobCounter()')
const GET_JOB_SELECTOR = selector('getJob(uint256)')
const JOB_ATTESTED_SELECTOR = selector('jobAttested(uint256)')
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

interface TickReport {
  head: string
  pages: number
  discovered: number
  scanned: number
  sends: { action: string; jobId: string; tx: string }[]
  skipped: string[]
}

// Reads go over the lean path (lib/lean.ts): plain fetch, hand-coded calldata
// and results. Sends reuse it; viem only encodes calldata and signs.

/** eth_getLogs over `pages` ranges of LOG_STEP blocks back from `blockHead`,
 * newest first, stopping early once `enough` is satisfied. Sequential, and a
 * failed page contributes nothing: no retry storm (each failed request used to
 * cost CPU building viem errors, times three retries). */
async function logPages(
  url: string,
  blockHead: bigint,
  pages: number,
  topics: (Hex | Hex[] | null)[],
  enough: (found: { topics: Hex[]; data: Hex }[]) => boolean = () => false,
): Promise<{ topics: Hex[]; data: Hex }[]> {
  const found: { topics: Hex[]; data: Hex }[] = []
  for (let i = 0; i < pages; i++) {
    const to = blockHead - BigInt(i) * LOG_STEP
    if (to < 0n) break
    const from = to > LOG_STEP ? to - LOG_STEP + 1n : 0n
    try {
      const params = [{ address: ERC8183, topics, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` }]
      found.push(...(await rpcOnce<{ topics: Hex[]; data: Hex }[]>(url, 'eth_getLogs', params)))
      if (enough(found)) break
    } catch {
      /* page unavailable this tick — the counter tail still covers new jobs */
    }
  }
  return found
}

// First-use secp256k1 setup is the expensive part of signing on a cold isolate:
// viem's default 8-bit precomputation table cost ~30 ms of CPU before the tick
// did any work, against the free plan's 10 ms budget. A 4-bit table is built in
// a fraction of that, and signatures stay fast.
let smallTable = false

function useSmallTable() {
  if (!smallTable) {
    secp256k1.ProjectivePoint.BASE._setWindowSize(4)
    smallTable = true
  }
}

/** One settlement tick: read state, perform at most MAX_SENDS transactions. */
export async function tick(env: Env, dryRun: boolean): Promise<TickReport> {
  const pub = createPublicClient({ chain: chainOf(env.ARC_RPC), transport: http(env.ARC_RPC) })
  const logsRpc = env.LOGS_RPC || DEFAULT_LOGS_RPC
  const reads = [env.ARC_RPC, logsRpc] as const // dRPC first; the official RPC as fallback
  const AGENT = getAddress(env.AGENT_ADDRESS || DEFAULT_AGENT)
  const ARBITER = getAddress(env.ARBITER_ADDRESS || DEFAULT_ARBITER)
  const price6 = BigInt(Math.round(Number(env.AGENT_PRICE_USDC || '2') * 1e6))

  const report: TickReport = { head: '0', pages: 0, discovered: 0, scanned: 0, sends: [], skipped: [] }
  const [counterHex, blockHex] = await Promise.all([
    rpc<Hex>(reads, 'eth_call', [{ to: ERC8183, data: JOB_COUNTER_CALL }, 'latest']),
    rpc<Hex>(reads, 'eth_blockNumber', []),
  ])
  const head = BigInt(counterHex)
  const blockHead = BigInt(blockHex)
  report.head = head.toString()

  // EVENT-based discovery: find our agent's jobs by their JobCreated logs
  // (provider-indexed), so unrelated churn on the shared ERC-8183 contract
  // cannot push an eligible job out of view. A counter tail is unioned in for
  // brand-new jobs and as the fallback when logs are unavailable. Processed
  // oldest-first, so stranded jobs recover before newer ones.
  const pages = Math.max(1, Number(env.DISCOVERY_PAGES ?? '') || DEFAULT_DISCOVERY_PAGES)
  report.pages = pages
  const created = await logPages(logsRpc, blockHead, pages, [JOB_CREATED_TOPIC, null, null, topicAddress(AGENT) as Hex])
  const idSet = new Set(created.map((l) => BigInt(l.topics[1])))
  const tailFrom = head > TAIL_JOBS ? head - TAIL_JOBS : 0n
  for (let i = tailFrom; i < head; i++) idSet.add(i)
  const ids = Array.from(idSet).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  report.discovered = idSet.size

  // One multicall reads every job's state. The registry's jobAttested (for the
  // attestation-repair path) is read only for OUR settled jobs, in a second
  // small multicall — most scanned ids are other agents' jobs.
  const idArg = (id: bigint) => id.toString(16).padStart(64, '0')
  const states = (await aggregate3(reads, ids.map((id) => ({ target: ERC8183, callData: `${GET_JOB_SELECTOR}${idArg(id)}` as Hex })))).map(decodeJob)
  report.scanned = ids.length
  const agentLc = AGENT.toLowerCase()
  const arbiterLc = ARBITER.toLowerCase()
  const ours = (job: JobView | undefined): job is JobView => job?.provider === agentLc && job.evaluator === arbiterLc
  const settledIdx = ids
    .map((_, i) => i)
    .filter((i) => {
      const job = states[i]
      return ours(job) && (job.status === JobStatus.Completed || job.status === JobStatus.Rejected)
    })
  const attestedAt = new Map<number, boolean>()
  if (settledIdx.length > 0) {
    const flags = await aggregate3(reads, settledIdx.map((i) => ({ target: REGISTRY, callData: `${JOB_ATTESTED_SELECTOR}${idArg(ids[i])}` as Hex })))
    // An unreadable flag counts as attested: never re-attest on a failed read.
    settledIdx.forEach((i, k) => attestedAt.set(i, flags[k] === undefined ? true : uint(word(flags[k] as Hex, 0)) === 1n))
  }

  // Crash safety. This tick can be killed at any instant (CPU limit, eviction)
  // and nothing is persisted between ticks, so correctness rests on three rules:
  //   1. every action is guarded on chain — a replayed setBudget / submit /
  //      complete / reject / attest reverts (WrongStatus, JobAlreadyAttested),
  //      and eth_estimateGas runs BEFORE a nonce is taken, so a replay is never
  //      even broadcast: no double effect;
  //   2. after a failed broadcast an account sends nothing more this tick, so a
  //      nonce is never skipped (no gap for a later tx to queue behind);
  //   3. a previous tick's tx still unmined a tick later (blocks are ~0.5 s) is
  //      REPLACED with a fee-bumped zero-value self-transfer rather than queued
  //      behind; whatever it was doing is re-derived from chain next tick.
  // A killed tick therefore only delays: the next one re-reads chain state.
  const nonces = new Map<Address, number>()
  const halted = new Set<Address>()
  async function feeQuote() {
    const [priceHex, tipHex] = await Promise.all([rpc<Hex>(reads, 'eth_gasPrice', []), rpc<Hex>(reads, 'eth_maxPriorityFeePerGas', [])])
    return { price: BigInt(priceHex), tip: BigInt(tipHex) }
  }
  async function sign(from: Address, transaction: Parameters<typeof signTransaction>[0]['transaction']): Promise<Hex> {
    useSmallTable()
    const privateKey = (from === AGENT ? env.AGENT_LEXICA_PRIVATE_KEY : env.ARBITER_PRIVATE_KEY) as Hex
    return signTransaction({ privateKey, transaction })
  }
  async function broadcast(from: Address, signed: Hex): Promise<Hex> {
    try {
      await rpc<Hex>(reads, 'eth_sendRawTransaction', [signed])
    } catch (e) {
      // A retried broadcast the node already has is a success, not a failure.
      if (!/already known|known transaction/i.test(String((e as Error).message))) {
        halted.add(from) // rule 2: never leave a nonce gap
        throw e
      }
    }
    return keccak256(signed)
  }

  /** The next nonce for `from`. On the account's first send this tick, a
   * pending tx left by a previous tick means it is stuck (rule 3): replace it
   * and send nothing else from this account until the next tick. */
  async function nextNonce(from: Address): Promise<number | undefined> {
    if (!nonces.has(from)) {
      const [latestHex, pendingHex] = await Promise.all([
        rpc<Hex>(reads, 'eth_getTransactionCount', [from, 'latest']),
        rpc<Hex>(reads, 'eth_getTransactionCount', [from, 'pending']),
      ])
      const latest = Number(latestHex)
      if (Number(pendingHex) > latest) {
        halted.add(from)
        const { price, tip } = await feeQuote()
        const signed = await sign(from, {
          chainId: 5042002,
          type: 'eip1559',
          to: from,
          value: 0n,
          nonce: latest,
          gas: 21_000n,
          maxPriorityFeePerGas: tip * 2n,
          maxFeePerGas: (price + tip) * 2n,
        })
        const tx = await broadcast(from, signed)
        report.sends.push({ action: `replace stuck tx at nonce ${latest}`, jobId: '-', tx })
        console.log(`[cron] replaced stuck tx of ${from} at nonce ${latest} → ${tx}`)
        return undefined
      }
      nonces.set(from, latest)
    }
    const n = nonces.get(from) as number
    nonces.set(from, n + 1)
    return n
  }

  /** A contract call as a raw EIP-1559 transaction — estimate, sign, broadcast
   * over the same lean RPC path as the reads (retries + fallback endpoint), with
   * no wallet client: on a cold isolate viem's wallet stack cost more CPU than
   * the signature. The address is public config; only the signature touches the
   * key, which is never used to derive anything. Undefined: not sent this tick. */
  async function sendRaw(from: Address, to: Address, data: Hex): Promise<Hex | undefined> {
    const [gasHex, { price, tip }] = await Promise.all([
      rpc<Hex>(reads, 'eth_estimateGas', [{ from, to, data }]), // rule 1: a revert stops here, before a nonce is taken
      feeQuote(),
    ])
    const nonce = await nextNonce(from)
    if (nonce === undefined) return undefined
    const signed = await sign(from, {
      chainId: 5042002,
      type: 'eip1559',
      to,
      data,
      nonce,
      gas: (BigInt(gasHex) * 120n) / 100n,
      maxPriorityFeePerGas: tip,
      maxFeePerGas: price + tip,
    })
    return broadcast(from, signed)
  }

  async function send(
    from: Address,
    action: string,
    jobId: bigint,
    params: { address: Address; abi: typeof erc8183Abi | typeof registryAbi; functionName: string; args: readonly unknown[] },
  ) {
    if (dryRun) {
      report.sends.push({ action: `DRY:${action}`, jobId: jobId.toString(), tx: '' })
      return
    }
    if (halted.has(from)) {
      report.skipped.push(`#${jobId} ${action} deferred to next tick`)
      return
    }
    const data = encodeFunctionData({ abi: params.abi, functionName: params.functionName, args: params.args } as never)
    const tx = await sendRaw(from, params.address, data)
    if (!tx) {
      report.skipped.push(`#${jobId} ${action} deferred to next tick`)
      return
    }
    report.sends.push({ action, jobId: jobId.toString(), tx })
    console.log(`[cron] ${action} #${jobId} → ${tx}`)
  }

  /** The reason a settlement committed on chain (JobCompleted / JobRejected
   * data), searched back a few pages. */
  async function settlementReason(jobId: bigint): Promise<Hex | undefined> {
    const topics: (Hex | Hex[])[] = [[JOB_COMPLETED_TOPIC, JOB_REJECTED_TOPIC], `0x${jobId.toString(16).padStart(64, '0')}`]
    const found = await logPages(logsRpc, blockHead, SUBMITTED_LOOKBACK_PAGES, topics, (f) => f.length > 0)
    const data = found[0]?.data
    return data && data.length >= 66 ? (data.slice(0, 66) as Hex) : undefined
  }

  /** Deliverable hash the provider actually submitted (topic-filtered, tiny),
   * searched back a few pages. Not found → the job is skipped this tick, never
   * aborting the whole scan. */
  async function submittedHash(jobId: bigint): Promise<Hex | undefined> {
    const topics = [JOB_SUBMITTED_TOPIC, `0x${jobId.toString(16).padStart(64, '0')}` as Hex]
    const found = await logPages(logsRpc, blockHead, SUBMITTED_LOOKBACK_PAGES, topics, (f) => f.length > 0)
    const data = found[0]?.data
    return data && data.length >= 66 ? (data.slice(0, 66) as Hex) : undefined
  }

  /** Credit terms must be earned: the agent's score as it stood at the hire
   * block, computed by the shared scoring module (the same code the API
   * serves) — so the verdict is identical whenever this tick runs. Checked
   * once, when pricing: the agent only escrows the credit share after this
   * passes, so a funded credit job already proves it (history up to the hire
   * block never changes — nothing to recompute). A failed read means "not
   * verifiable yet", never a pass. */
  async function creditEarned(jobId: bigint, terms: TermsMarker): Promise<boolean> {
    if (terms.tier !== 'credit') return true
    const atHire = await computeReputation(AGENT, { atJob: jobId }).catch(() => null)
    if (!atHire) {
      report.skipped.push(`#${jobId} hire-block score unavailable, retry next tick`)
      return false
    }
    if (!creditTermsEarned(terms, atHire.score)) {
      report.skipped.push(`#${jobId} credit terms not earned: score ${atHire.score} at block ${atHire.breakdown.asOf.block}`)
      return false
    }
    return true
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

  for (let i = 0; i < ids.length && report.sends.length < MAX_SENDS; i++) {
    const job = states[i]
    if (!job) continue
    const jobId = ids[i]
    try {
    if (!ours(job)) continue
    if (isJudgedJob(job.description)) {
      if (job.status !== JobStatus.Completed && job.status !== JobStatus.Rejected) report.skipped.push(`#${jobId} judged (local-worker feature)`)
      continue
    }
    const terms = parseTermsMarker(job.description)

    if (job.status === JobStatus.Open && job.budget === 0n) {
      // Never price a job on credit terms the agent had not earned at hire.
      if (terms && !(await creditEarned(jobId, terms))) continue
      const escrow6 = terms?.tier === 'credit' ? (price6 * BigInt(100 - ADVANCE_PCT)) / 100n : price6
      await send(AGENT, 'agent setBudget', jobId, { address: ERC8183, abi: erc8183Abi, functionName: 'setBudget', args: [jobId, escrow6, '0x'] })
    } else if (job.status === JobStatus.Funded) {
      if (terms && !(await termsSatisfied(job, terms))) {
        report.skipped.push(`#${jobId} terms not yet satisfied`)
        continue
      }
      const tamper = /\[bad\]|tamper/i.test(job.description)
      const output = tamper ? enrichTampered(inputRows as WalletRow[]) : enrich(inputRows as WalletRow[])
      await send(AGENT, `agent submit${tamper ? ' (tampered run)' : ''}`, jobId, {
        address: ERC8183,
        abi: erc8183Abi,
        functionName: 'submit',
        args: [jobId, hashOutput(output), '0x'],
      })
    } else if (job.status === JobStatus.Submitted) {
      if (nowSec >= Number(job.expiredAt)) {
        const reason = keccak256(toHex(`agentscore:rejected-late:job-${jobId}`))
        await send(ARBITER, 'arbiter reject (late)', jobId, { address: ERC8183, abi: erc8183Abi, functionName: 'reject', args: [jobId, reason, '0x'] })
        await send(ARBITER, 'arbiter attest REJECTED', jobId, { address: REGISTRY, abi: registryAbi, functionName: 'attest', args: [jobId, getAddress(job.provider), 1, reason] })
        continue
      }
      const onchain = await submittedHash(jobId)
      if (!onchain) {
        report.skipped.push(`#${jobId} submitted hash not found yet`)
        continue
      }
      // Deterministic verification by re-derivation — no storage needed.
      const result = verify(inputRows as WalletRow[], enrich(inputRows as WalletRow[]), onchain)
      const good = result.ok
      const reason = keccak256(toHex(good ? `agentscore:verified:job-${jobId}` : `agentscore:rejected-badwork:job-${jobId}`))
      await send(ARBITER, good ? 'arbiter complete (verified)' : 'arbiter reject (bad work)', jobId, {
        address: ERC8183,
        abi: erc8183Abi,
        functionName: good ? 'complete' : 'reject',
        args: [jobId, reason, '0x'],
      })
      await send(ARBITER, `arbiter attest ${good ? 'APPROVED' : 'REJECTED'}`, jobId, {
        address: REGISTRY,
        abi: registryAbi,
        functionName: 'attest',
        args: [jobId, getAddress(job.provider), good ? 0 : 1, reason],
      })
    } else if (job.status === JobStatus.Completed || job.status === JobStatus.Rejected) {
      // Repairs, both idempotent: missing attestation, then linked collateral.
      // jobAttested came from the batched multicall (no per-job subrequest).
      const attested = attestedAt.get(i) ?? true
      if (!attested) {
        // A tick killed between settling and attesting lands here. Attest with
        // the reason the settlement actually committed on chain (a late reject
        // and a bad-work reject differ), never a re-derived guess.
        const good = job.status === JobStatus.Completed
        const reason = await settlementReason(jobId)
        if (!reason) {
          report.skipped.push(`#${jobId} settlement reason not found yet`)
          continue
        }
        await send(ARBITER, `arbiter attest ${good ? 'APPROVED' : 'REJECTED'} (repair)`, jobId, {
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
          await send(ARBITER, release ? 'arbiter release collateral' : 'arbiter slash collateral', terms.collateralJobId, {
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
