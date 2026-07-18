import { createWalletClient, getAddress, http, keccak256, parseUnits, toHex, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { publicClient } from './lib/chain.js'
import { erc8183Abi, registryAbi } from './lib/abi.js'
import { arcTestnet, ARC_RPC, ERC8183_ADDRESS, EXPLORER_URL, JobStatus, REGISTRY_ADDRESS } from './lib/config.js'

const PRICE_6 = parseUnits('10', 6) // Lexica's listed price
const POLL_MS = 6000

// ---- Pure, testable decision logic ---------------------------------------
interface JobView {
  status: number
  budget: bigint
  evaluator: Address
  expiredAt: bigint
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
        await send(`agent setBudget #${jobId} (10 USDC)`, agent, {
          address: ERC8183_ADDRESS,
          abi: erc8183Abi,
          functionName: 'setBudget',
          args: [jobId, PRICE_6, '0x'],
        })
      } else if (agentShouldSubmit(job)) {
        await send(`agent submit #${jobId}`, agent, {
          address: ERC8183_ADDRESS,
          abi: erc8183Abi,
          functionName: 'submit',
          args: [jobId, keccak256(toHex(`agentscore:deliverable:job-${jobId}`)), '0x'],
        })
      } else {
        const verdict = arbiterVerdict(job, Math.floor(Date.now() / 1000))
        if (verdict === 'approve') {
          const reason = keccak256(toHex(`agentscore:auto-approved:job-${jobId}`))
          await send(`arbiter complete #${jobId} release 10 USDC`, arbiter, {
            address: ERC8183_ADDRESS,
            abi: erc8183Abi,
            functionName: 'complete',
            args: [jobId, reason, '0x'],
          })
          await send(`arbiter attest APPROVED #${jobId}`, arbiter, {
            address: REGISTRY_ADDRESS,
            abi: registryAbi,
            functionName: 'attest',
            args: [jobId, getAddress(job.provider), 0, reason],
          })
          log(`✅ job #${jobId} settled — 10 USDC released, verdict attested.`)
        } else if (verdict === 'reject') {
          await send(`arbiter reject #${jobId}`, arbiter, {
            address: ERC8183_ADDRESS,
            abi: erc8183Abi,
            functionName: 'reject',
            args: [jobId, keccak256(toHex(`agentscore:rejected-late:job-${jobId}`)), '0x'],
          })
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
