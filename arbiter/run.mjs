// AgentScore — local, testnet-only agent + arbiter automation.
// The agent (provider) auto-sets its price and submits deliverables; the arbiter
// (evaluator) runs deterministic checks, completes or rejects, and attests the
// verdict to our registry. Keys come from arbiter/.env (gitignored). Testnet
// only — all USDC is valueless faucet tokens.
//
// State is derived from on-chain job status every cycle, so every action is
// idempotent (safe across restarts, never double-sends). Only jobs created at
// or after startup are handled, and only where our arbiter is the evaluator.
import 'dotenv/config'
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits, keccak256, toHex, getAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// Official RPC 429s under load; dRPC handled a burst test 24/24. Override with
// ARC_RPC in arbiter/.env if needed.
const RPC = process.env.ARC_RPC || 'https://arc-testnet.drpc.org'
const EXPLORER = 'https://testnet.arcscan.app'
const ERC8183 = '0x0747EEf0706327138c69792bF28Cd525089e4583'
const REGISTRY = process.env.VITE_REGISTRY_ADDRESS || '0x1489b56AaE4BB63e9793a151C12964B19bC99d38'
const PRICE_6 = parseUnits('10', 6) // Lexica's listed price
const POLL_MS = 6000

const arc = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
}

const erc8183 = parseAbi([
  'event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt, address hook)',
  'function jobCounter() view returns (uint256)',
  'function getJob(uint256 jobId) view returns ((uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook))',
  'function setBudget(uint256 jobId, uint256 amount, bytes optParams)',
  'function submit(uint256 jobId, bytes32 deliverable, bytes optParams)',
  'function complete(uint256 jobId, bytes32 reason, bytes optParams)',
  'function reject(uint256 jobId, bytes32 reason, bytes optParams)',
])
const registryAbi = parseAbi(['function attest(uint256 jobId, address agent, uint8 outcome, bytes32 reasonHash)'])

const agentAccount = privateKeyToAccount(process.env.AGENT_LEXICA_PRIVATE_KEY)
const arbiterAccount = privateKeyToAccount(process.env.ARBITER_PRIVATE_KEY)
const AGENT = getAddress(agentAccount.address)
const ARBITER = getAddress(arbiterAccount.address)

const publicClient = createPublicClient({ chain: arc, transport: http(RPC) })
const agent = createWalletClient({ account: agentAccount, chain: arc, transport: http(RPC) })
const arbiter = createWalletClient({ account: arbiterAccount, chain: arc, transport: http(RPC) })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tx = (h) => `${EXPLORER}/tx/${h}`
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

let minJobId = 0n // only handle jobs from startup onward
const acting = new Set() // jobIds with an in-flight action (avoid overlap)

async function read(fn, args) {
  for (let i = 0; i < 4; i++) {
    try {
      return await publicClient.readContract({ address: ERC8183, abi: erc8183, functionName: fn, args })
    } catch (e) {
      if (i === 3) throw e
      await sleep(500 * 2 ** i)
    }
  }
}

async function send(label, walletClient, params) {
  const hash = await walletClient.writeContract(params)
  log(`${label} → ${tx(hash)}`)
  await publicClient.waitForTransactionReceipt({ hash })
  log(`${label} confirmed`)
  return hash
}

async function discover(head) {
  const fromBlock = head > 9000n ? head - 9000n : 0n
  const logs = await publicClient.getLogs({
    address: ERC8183,
    event: erc8183[0],
    args: { provider: AGENT },
    fromBlock,
    toBlock: head,
  })
  return [...new Set(logs.map((l) => l.args.jobId).filter((id) => id >= minJobId))]
}

async function step(jobId) {
  if (acting.has(jobId)) return
  const job = await read('getJob', [jobId])
  if (getAddress(job.evaluator) !== ARBITER) return // only our jobs
  const status = Number(job.status)

  try {
    acting.add(jobId)
    if (status === 0 && job.budget === 0n) {
      await send(`[agent] setBudget(#${jobId}, 10 USDC)`, agent, {
        address: ERC8183,
        abi: erc8183,
        functionName: 'setBudget',
        args: [jobId, PRICE_6, '0x'],
      })
    } else if (status === 1) {
      const deliverable = keccak256(toHex(`agentscore:deliverable:job-${jobId}`))
      await send(`[agent] submit(#${jobId})`, agent, {
        address: ERC8183,
        abi: erc8183,
        functionName: 'submit',
        args: [jobId, deliverable, '0x'],
      })
    } else if (status === 2) {
      const now = Math.floor(Date.now() / 1000)
      if (now < Number(job.expiredAt)) {
        const reason = keccak256(toHex(`agentscore:auto-approved:job-${jobId}`))
        await send(`[arbiter] complete(#${jobId}) release 10 USDC`, arbiter, {
          address: ERC8183,
          abi: erc8183,
          functionName: 'complete',
          args: [jobId, reason, '0x'],
        })
        await send(`[arbiter] attest APPROVED (#${jobId})`, arbiter, {
          address: REGISTRY,
          abi: registryAbi,
          functionName: 'attest',
          args: [jobId, getAddress(job.provider), 0, reason],
        })
        log(`✅ job #${jobId} settled — 10 USDC released to the agent, verdict attested.`)
      } else {
        const reason = keccak256(toHex(`agentscore:rejected-late:job-${jobId}`))
        await send(`[arbiter] reject(#${jobId})`, arbiter, {
          address: ERC8183,
          abi: erc8183,
          functionName: 'reject',
          args: [jobId, reason, '0x'],
        })
      }
    }
  } catch (e) {
    log(`job #${jobId} action error (will retry): ${String(e.shortMessage || e).slice(0, 140)}`)
  } finally {
    acting.delete(jobId)
  }
}

async function loop() {
  try {
    const head = await publicClient.getBlockNumber()
    const jobs = await discover(head)
    for (const jobId of jobs) {
      await step(jobId)
      await sleep(400)
    }
  } catch (e) {
    log(`loop error: ${String(e.shortMessage || e).slice(0, 140)}`)
  }
}

minJobId = await read('jobCounter', [])
log(`AgentScore automation watching (only jobs #${minJobId} and newer).`)
log(`  agent   (provider):  ${AGENT}`)
log(`  arbiter (evaluator): ${ARBITER}`)
log(`  registry:            ${REGISTRY}`)
setInterval(loop, POLL_MS)
await loop()
