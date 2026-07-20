import { createWalletClient, getAddress, http, keccak256, parseUnits, toHex, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { publicClient } from './lib/chain.js'
import { erc8183Abi, registryAbi } from './lib/abi.js'
import { arcTestnet, ARC_RPC, ERC8183_ADDRESS, EXPLORER_URL, JobStatus, REGISTRY_ADDRESS, USDC_ADDRESS } from './lib/config.js'
import { ADVANCE_PCT, COLLATERAL_PCT, isCollateralJob, parseTermsMarker, type TermsMarker } from './lib/credit.js'
import { enrich, enrichTampered, hashOutput, loadInputDataset, verify } from './lib/enrichment.js'
import { agentWriteMemo, arbiterJudge, isJudgedJob, isLazyRun, judgedSpec, llmKeyPresent, reasonHashOf } from './lib/judged.js'
import { getDeliverable, saveDeliverable, setVerdict, type DeliverableRecord } from './lib/store.js'

const TRANSFER_TOPIC = keccak256(toHex('Transfer(address,address,uint256)'))
const topicAddress = (a: string) => `0x${'0'.repeat(24)}${a.slice(2).toLowerCase()}`

const PRICE_6 = parseUnits(process.env.AGENT_PRICE_USDC || '10', 6)
const POLL_MS = 6000

/** Read the deliverable hash the provider actually submitted onchain. */
async function onchainDeliverable(jobId: bigint): Promise<`0x${string}` | undefined> {
  const head = await publicClient.getBlockNumber()
  const fromBlock = head > 9000n ? head - 9000n : 0n
  const submittedEvent = erc8183Abi.find((x) => x.type === 'event' && x.name === 'JobSubmitted')!
  const logs = await publicClient.getLogs({
    address: ERC8183_ADDRESS,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event: submittedEvent as any,
    args: { jobId },
    fromBlock,
    toBlock: head,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (logs[0] as any)?.args?.deliverable as `0x${string}` | undefined
}

// ---- Pure, testable decision logic ---------------------------------------
interface JobView {
  status: number
  budget: bigint
  client: Address
  evaluator: Address
  expiredAt: bigint
  description: string
  provider: Address
}

/** The agent prices an Open job with no budget yet. */
export function agentShouldSetBudget(job: Pick<JobView, 'status' | 'budget'>): boolean {
  return job.status === JobStatus.Open && job.budget === 0n
}

/** The agent submits once the client funds escrow. */
export function agentShouldSubmit(job: Pick<JobView, 'status'>): boolean {
  return job.status === JobStatus.Funded
}

/**
 * Arbiter verdict for a submitted job: approve if the deliverable was submitted
 * before the deadline, otherwise reject. (Status reaching Submitted guarantees a
 * deliverable hash is present onchain.)
 */
export function arbiterVerdict(job: Pick<JobView, 'status' | 'expiredAt'>, nowSec: number): 'approve' | 'reject' | 'skip' {
  if (job.status !== JobStatus.Submitted) return 'skip'
  return nowSec < Number(job.expiredAt) ? 'approve' : 'reject'
}

// ---- Worker ----------------------------------------------------------------
const tx = (h: string) => `${EXPLORER_URL}/tx/${h}`
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), '[worker]', ...a)

export async function startWorker(): Promise<void> {
  const arbiterKey = process.env.ARBITER_PRIVATE_KEY
  const agentKey = process.env.AGENT_LEXICA_PRIVATE_KEY
  if (!arbiterKey || !agentKey) {
    log('signing keys not set — worker disabled (read-only API).')
    return
  }

  const agentAccount = privateKeyToAccount(agentKey as `0x${string}`)
  const arbiterAccount = privateKeyToAccount(arbiterKey as `0x${string}`)
  const AGENT = getAddress(agentAccount.address)
  const ARBITER = getAddress(arbiterAccount.address)
  const agent = createWalletClient({ account: agentAccount, chain: arcTestnet, transport: http(ARC_RPC) })
  const arbiter = createWalletClient({ account: arbiterAccount, chain: arcTestnet, transport: http(ARC_RPC) })

  const acting = new Set<bigint>()
  const jobCreatedEvent = erc8183Abi.find((x) => x.type === 'event' && x.name === 'JobCreated')!
  const minJobId = (await publicClient.readContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'jobCounter' })) as bigint

  log(`watching (jobs #${minJobId}+, evaluator=${ARBITER}, agent=${AGENT})`)

  async function send(label: string, wallet: typeof agent | typeof arbiter, params: Parameters<typeof wallet.writeContract>[0]) {
    const hash = await wallet.writeContract(params)
    log(`${label} → ${tx(hash)}`)
    await publicClient.waitForTransactionReceipt({ hash })
  }

  /**
   * The agent's side of credit terms — verify the advance landed (credit tier)
   * or the collateral is posted and correctly shaped (collateral tier) BEFORE
   * doing any work. This is orchestration + self-interest, not chain law: the
   * agent protects itself exactly like a contractor checking the deposit.
   */
  async function termsSatisfied(jobId: bigint, job: JobView, terms: TermsMarker): Promise<boolean> {
    if (terms.tier === 'credit') {
      if (!terms.advanceTx) {
        log(`job #${jobId} credit terms but no advance tx in marker — waiting`)
        return false
      }
      const needed = (PRICE_6 * BigInt(ADVANCE_PCT)) / 100n
      const rcpt = await publicClient.getTransactionReceipt({ hash: terms.advanceTx }).catch(() => null)
      const paid =
        rcpt?.status === 'success' &&
        rcpt.logs.some(
          (l) =>
            getAddress(l.address) === getAddress(USDC_ADDRESS) &&
            l.topics[0]?.toLowerCase() === TRANSFER_TOPIC.toLowerCase() &&
            l.topics[1]?.toLowerCase() === topicAddress(job.client) &&
            l.topics[2]?.toLowerCase() === topicAddress(AGENT) &&
            BigInt(l.data) >= needed,
        )
      if (!paid) {
        log(`job #${jobId} credit terms: advance of ${Number(needed) / 1e6} USDC not verified yet — not working`)
        return false
      }
      return true
    }
    if (terms.tier === 'collateral') {
      if (terms.collateralJobId === undefined) {
        log(`job #${jobId} collateral terms but no collateral job in marker — not working`)
        return false
      }
      const col = (await publicClient.readContract({
        address: ERC8183_ADDRESS,
        abi: erc8183Abi,
        functionName: 'getJob',
        args: [terms.collateralJobId],
      })) as JobView
      const needed = (PRICE_6 * BigInt(COLLATERAL_PCT)) / 100n
      const ok =
        isCollateralJob(col.description) &&
        getAddress(col.client) === getAddress(job.provider) && // the agent funds it
        getAddress(col.provider) === getAddress(job.client) && // the client is paid on slash
        getAddress(col.evaluator) === ARBITER &&
        (col.status === JobStatus.Funded || col.status === JobStatus.Submitted) &&
        col.budget >= needed
      if (!ok) {
        log(`job #${jobId} collateral #${terms.collateralJobId} not verified (need ${Number(needed) / 1e6} USDC locked) — not working`)
        return false
      }
      return true
    }
    return true
  }

  /**
   * Linked collateral settlement, idempotent: once the main job is terminal,
   * release the mirror-job collateral back to the agent (main settled → reject
   * refunds its funder) or slash it to the client (main rejected → complete
   * pays its provider). Never attested to the registry — collateral is an
   * escrow mechanism, not work.
   */
  async function settleLinkedCollateralIfAny(jobId: bigint, job: JobView) {
    const terms = parseTermsMarker(job.description)
    if (terms?.collateralJobId === undefined) return
    const colId = terms.collateralJobId
    const col = (await publicClient.readContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'getJob', args: [colId] })) as JobView
    if (col.status !== JobStatus.Funded && col.status !== JobStatus.Submitted) return // already settled
    if (!isCollateralJob(col.description) || getAddress(col.evaluator) !== ARBITER) return
    if (job.status === JobStatus.Completed) {
      const reason = reasonHashOf(`Collateral released: main job #${jobId} settled cleanly.`)
      await send(`arbiter release collateral #${colId} → refund to agent`, arbiter, { address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'reject', args: [colId, reason, '0x'] })
      log(`↩ collateral #${colId} released back to the agent — main job #${jobId} settled.`)
    } else {
      const reason = reasonHashOf(`Collateral slashed: main job #${jobId} was rejected.`)
      await send(`arbiter slash collateral #${colId} → pay client`, arbiter, { address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'complete', args: [colId, reason, '0x'] })
      log(`⚔ collateral #${colId} slashed to the client — main job #${jobId} rejected.`)
    }
  }

  /**
   * Judged-quality verdict: one deterministic integrity check (the stored memo
   * must hash to the onchain submission), then an independent LLM evaluation on
   * a different model family — never re-deriving the work. Any LLM failure
   * throws → caught by step()'s catch → retried next cycle. A verdict is never
   * fabricated.
   */
  async function settleJudged(jobId: bigint, job: JobView, rec: DeliverableRecord, nowSec: number) {
    if (!llmKeyPresent()) {
      log(`job #${jobId} awaits a judged verdict but LLM_API_KEY is missing — skipping (no fabricated verdict)`)
      return
    }
    const onchain = await onchainDeliverable(jobId)
    const memo = rec.memo
    const hashMatch = Boolean(memo) && Boolean(onchain) && keccak256(toHex(memo as string)).toLowerCase() === (onchain as string).toLowerCase()
    if (!memo || !hashMatch) {
      // Integrity failure is a deterministic fact, not a judgment call.
      const reasoning = 'Deliverable integrity check failed: the stored memo does not hash to the onchain submission.'
      const reason = reasonHashOf(reasoning)
      const settleTx = await arbiter.writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'reject', args: [jobId, reason, '0x'] })
      log(`arbiter REJECTED #${jobId} (judged: integrity failure) → ${tx(settleTx)}`)
      await publicClient.waitForTransactionReceipt({ hash: settleTx })
      await send(`arbiter attest REJECTED #${jobId}`, arbiter, { address: REGISTRY_ADDRESS, abi: registryAbi, functionName: 'attest', args: [jobId, getAddress(job.provider), 1, reason] })
      setVerdict(jobId.toString(), { outcome: 'rejected', reasoning, reasonHash: reason, arbiterModel: 'integrity-check', deliverableHashMatch: false, verifiedAt: nowSec, settleTx })
      return
    }
    const v = await arbiterJudge(rec.spec, memo) // throws loudly on provider failure
    const scores = v.rubric.map((r) => `${r.score}/${r.max}`).join(' ')
    if (v.pass) {
      const settleTx = await arbiter.writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'complete', args: [jobId, v.reasonHash, '0x'] })
      log(`arbiter JUDGED PASS #${jobId} (${v.arbiterModel}: ${scores}) — complete → ${tx(settleTx)}`)
      await publicClient.waitForTransactionReceipt({ hash: settleTx })
      await send(`arbiter attest APPROVED #${jobId}`, arbiter, { address: REGISTRY_ADDRESS, abi: registryAbi, functionName: 'attest', args: [jobId, getAddress(job.provider), 0, v.reasonHash] })
      setVerdict(jobId.toString(), { outcome: 'approved', rubric: v.rubric, reasoning: v.reasoning, reasonHash: v.reasonHash, arbiterModel: v.arbiterModel, deliverableHashMatch: true, verifiedAt: nowSec, settleTx })
      log(`✅ job #${jobId} settled — judged pass, written reasoning hash-committed onchain.`)
    } else {
      const settleTx = await arbiter.writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'reject', args: [jobId, v.reasonHash, '0x'] })
      log(`arbiter JUDGED FAIL #${jobId} (${v.arbiterModel}: ${scores}) — reject → ${tx(settleTx)}`)
      await publicClient.waitForTransactionReceipt({ hash: settleTx })
      await send(`arbiter attest REJECTED #${jobId}`, arbiter, { address: REGISTRY_ADDRESS, abi: registryAbi, functionName: 'attest', args: [jobId, getAddress(job.provider), 1, v.reasonHash] })
      setVerdict(jobId.toString(), { outcome: 'rejected', rubric: v.rubric, reasoning: v.reasoning, reasonHash: v.reasonHash, arbiterModel: v.arbiterModel, deliverableHashMatch: true, verifiedAt: nowSec, settleTx })
      log(`❌ job #${jobId} rejected — judged fail, escrow refunded, reasoning hash-committed onchain.`)
    }
  }

  async function step(jobId: bigint) {
    if (acting.has(jobId)) return
    const job = (await publicClient.readContract({
      address: ERC8183_ADDRESS,
      abi: erc8183Abi,
      functionName: 'getJob',
      args: [jobId],
    })) as JobView & { provider: Address }
    if (getAddress(job.evaluator) !== ARBITER) return
    try {
      acting.add(jobId)
      if (agentShouldSetBudget(job)) {
        // Credit tier: the advance is paid directly, so escrow only the rest.
        const terms = parseTermsMarker(job.description)
        const escrow6 = terms?.tier === 'credit' ? (PRICE_6 * BigInt(100 - ADVANCE_PCT)) / 100n : PRICE_6
        await send(`agent setBudget #${jobId}${terms?.tier === 'credit' ? ` (credit: ${100 - ADVANCE_PCT}% escrow after ${ADVANCE_PCT}% advance)` : ''}`, agent, {
          address: ERC8183_ADDRESS,
          abi: erc8183Abi,
          functionName: 'setBudget',
          args: [jobId, escrow6, '0x'],
        })
      } else if (agentShouldSubmit(job)) {
        // Credit-terms gate: no work until the terms are verifiably satisfied.
        const jobTerms = parseTermsMarker(job.description)
        if (jobTerms && !(await termsSatisfied(jobId, job, jobTerms))) return
        if (isJudgedJob(job.description)) {
          // Judged-quality job: the agent produces genuine LLM work. Without the
          // free-tier key we loudly skip — nothing is ever fabricated.
          if (!llmKeyPresent()) {
            log(`job #${jobId} is [JUDGED] but LLM_API_KEY is missing — skipping (no fabricated work)`)
            return
          }
          const spec = judgedSpec(job.description)
          const lazy = isLazyRun(job.description)
          const { memo, model } = await agentWriteMemo(spec, lazy)
          const outputHash = keccak256(toHex(memo))
          saveDeliverable({
            jobId: jobId.toString(),
            kind: 'judged',
            producedBy: AGENT,
            spec,
            inputRows: loadInputDataset().length,
            output: [],
            memo,
            agentModel: model,
            outputHash,
            createdAt: Math.floor(Date.now() / 1000),
          })
          const hash = await agent.writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'submit', args: [jobId, outputHash, '0x'] })
          log(`agent submit #${jobId} (judged memo by ${model}, ${memo.length} chars${lazy ? ', LAZY run' : ''}) → ${tx(hash)}`)
          await publicClient.waitForTransactionReceipt({ hash })
          const rec = getDeliverable(jobId.toString())
          if (rec) {
            rec.submittedTx = hash
            saveDeliverable(rec)
          }
          return
        }
        // Agent does REAL work: dedupe + risk-label the dataset, hash the actual
        // output, store it, and submit that hash. ([BAD] triggers a faulty run
        // for the reject demo.)
        const tamper = /\[bad\]|tamper/i.test(job.description)
        const input = loadInputDataset()
        const output = tamper ? enrichTampered(input) : enrich(input)
        const outputHash = hashOutput(output)
        saveDeliverable({
          jobId: jobId.toString(),
          producedBy: AGENT,
          spec: 'dedupe wallet dataset by address + risk-label each row',
          inputRows: input.length,
          output,
          outputHash,
          createdAt: Math.floor(Date.now() / 1000),
        })
        const hash = await agent.writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'submit', args: [jobId, outputHash, '0x'] })
        log(`agent submit #${jobId} (real output: ${output.length} rows${tamper ? ', TAMPERED' : ''}) → ${tx(hash)}`)
        await publicClient.waitForTransactionReceipt({ hash })
        const rec = getDeliverable(jobId.toString())
        if (rec) {
          rec.submittedTx = hash
          saveDeliverable(rec)
        }
      } else {
        // Terminal jobs: settle any linked collateral (idempotent), then stop —
        // no retry churn on already-settled jobs.
        if (job.status === JobStatus.Completed || job.status === JobStatus.Rejected) {
          await settleLinkedCollateralIfAny(jobId, job)
          return
        }
        // Arbiter genuinely verifies the produced deliverable before settling.
        const nowSec = Math.floor(Date.now() / 1000)
        if (nowSec >= Number(job.expiredAt)) {
          await send(`arbiter reject #${jobId} (past deadline)`, arbiter, {
            address: ERC8183_ADDRESS,
            abi: erc8183Abi,
            functionName: 'reject',
            args: [jobId, keccak256(toHex(`agentscore:rejected-late:job-${jobId}`)), '0x'],
          })
          return
        }
        const rec = getDeliverable(jobId.toString())
        if (!rec) {
          log(`job #${jobId} submitted but no local deliverable to verify — skipping`)
          return
        }
        if (rec.kind === 'judged') {
          await settleJudged(jobId, job, rec, nowSec)
          return
        }
        const onchain = await onchainDeliverable(jobId)
        const result = verify(loadInputDataset(), rec.output, onchain ?? rec.outputHash)
        if (result.ok) {
          const reason = keccak256(toHex(`agentscore:verified:job-${jobId}`))
          const settleTx = await arbiter.writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'complete', args: [jobId, reason, '0x'] })
          log(`arbiter VERIFIED #${jobId} (${result.gotRowCount} rows, checksum ✓) — complete → ${tx(settleTx)}`)
          await publicClient.waitForTransactionReceipt({ hash: settleTx })
          await send(`arbiter attest APPROVED #${jobId}`, arbiter, { address: REGISTRY_ADDRESS, abi: registryAbi, functionName: 'attest', args: [jobId, getAddress(job.provider), 0, reason] })
          setVerdict(jobId.toString(), { outcome: 'approved', checks: result.checks, expectedRowCount: result.expectedRowCount, gotRowCount: result.gotRowCount, verifiedAt: nowSec, settleTx })
          log(`✅ job #${jobId} settled — USDC released to the agent, verdict attested.`)
        } else {
          const reason = keccak256(toHex(`agentscore:rejected-badwork:job-${jobId}`))
          const settleTx = await arbiter.writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'reject', args: [jobId, reason, '0x'] })
          log(`arbiter REJECTED #${jobId} — deliverable failed verification ${JSON.stringify(result.checks)} → ${tx(settleTx)}`)
          await publicClient.waitForTransactionReceipt({ hash: settleTx })
          await send(`arbiter attest REJECTED #${jobId}`, arbiter, { address: REGISTRY_ADDRESS, abi: registryAbi, functionName: 'attest', args: [jobId, getAddress(job.provider), 1, reason] })
          setVerdict(jobId.toString(), { outcome: 'rejected', checks: result.checks, expectedRowCount: result.expectedRowCount, gotRowCount: result.gotRowCount, verifiedAt: nowSec, settleTx })
          log(`❌ job #${jobId} rejected — escrow refunded to the client.`)
        }
      }
    } catch (e) {
      log(`job #${jobId} error (retry next cycle): ${String((e as Error).message ?? e).slice(0, 140)}`)
    } finally {
      acting.delete(jobId)
    }
  }

  async function loop() {
    try {
      const head = await publicClient.getBlockNumber()
      const fromBlock = head > 9000n ? head - 9000n : 0n
      const logs = await publicClient.getLogs({
        address: ERC8183_ADDRESS,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        event: jobCreatedEvent as any,
        args: { provider: AGENT },
        fromBlock,
        toBlock: head,
      })
      const jobIds = [...new Set(logs.map((l) => (l as unknown as { args: { jobId: bigint } }).args.jobId).filter((id) => id >= minJobId))]
      for (const jobId of jobIds) {
        await step(jobId)
      }
    } catch (e) {
      log(`loop error: ${String((e as Error).message ?? e).slice(0, 140)}`)
    }
  }

  setInterval(loop, POLL_MS)
  await loop()
}
