import { createWalletClient, getAddress, http, keccak256, parseUnits, toHex, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { publicClient } from './lib/chain.js'
import { erc8183Abi, registryAbi } from './lib/abi.js'
import { arcTestnet, ARC_RPC, ERC8183_ADDRESS, EXPLORER_URL, JobStatus, REGISTRY_ADDRESS } from './lib/config.js'
import { enrich, enrichTampered, hashOutput, loadInputDataset, verify } from './lib/enrichment.js'
import { getDeliverable, saveDeliverable, setVerdict } from './lib/store.js'

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
        await send(`agent setBudget #${jobId}`, agent, {
          address: ERC8183_ADDRESS,
          abi: erc8183Abi,
          functionName: 'setBudget',
          args: [jobId, PRICE_6, '0x'],
        })
      } else if (agentShouldSubmit(job)) {
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
