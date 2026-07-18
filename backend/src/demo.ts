// Runs two live jobs from the separate demo client wallet (never the arbiter):
//   A — agent produces a correct enrichment → arbiter verifies → settles.
//   B — agent produces a tampered deliverable → arbiter rejects → refunds.
// The backend worker must be running (it does the agent + arbiter steps).
import 'dotenv/config'
import { createPublicClient, createWalletClient, decodeEventLog, http, parseAbi, zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { erc8183Abi } from './lib/abi.js'
import { ARBITER_ADDRESS, ARC_RPC, arcTestnet, ERC8183_ADDRESS, EXPLORER_URL, LIVE_AGENT_ADDRESS, USDC_ADDRESS } from './lib/config.js'

const usdcAbi = parseAbi(['function approve(address spender, uint256 amount) returns (bool)'])
const key = process.env.DEMO_CLIENT_PRIVATE_KEY
if (!key) throw new Error('DEMO_CLIENT_PRIVATE_KEY not set in backend/.env')

const account = privateKeyToAccount(key as `0x${string}`)
const pub = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC) })
const client = createWalletClient({ account, chain: arcTestnet, transport: http(ARC_RPC) })
const tx = (h: string) => `${EXPLORER_URL}/tx/${h}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const getJob = (id: bigint) => pub.readContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'getJob', args: [id] })

async function run(label: string, description: string) {
  console.log(`\n=== ${label} ===`)
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 3600)
  const createHash = await client.writeContract({
    address: ERC8183_ADDRESS,
    abi: erc8183Abi,
    functionName: 'createJob',
    args: [LIVE_AGENT_ADDRESS, ARBITER_ADDRESS, expiredAt, description, zeroAddress],
  })
  const receipt = await pub.waitForTransactionReceipt({ hash: createHash })
  let jobId = 0n
  for (const lg of receipt.logs) {
    try {
      const d = decodeEventLog({ abi: erc8183Abi, topics: lg.topics, data: lg.data })
      if (d.eventName === 'JobCreated') {
        jobId = (d.args as { jobId: bigint }).jobId
        break
      }
    } catch {
      /* not this event */
    }
  }
  console.log(`client createJob → job #${jobId}   ${tx(createHash)}`)

  // Wait for the agent worker to set the budget.
  let budget = 0n
  for (let i = 0; i < 25; i++) {
    const has = await pub.readContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'jobHasBudget', args: [jobId] })
    if (has) {
      budget = (await getJob(jobId)).budget
      break
    }
    await sleep(4000)
  }
  if (budget === 0n) throw new Error(`agent never set budget for #${jobId}`)
  console.log(`agent set price: ${Number(budget) / 1e6} USDC`)

  // Client approves the EXACT amount, then funds escrow.
  const approveHash = await client.writeContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'approve', args: [ERC8183_ADDRESS, budget] })
  await pub.waitForTransactionReceipt({ hash: approveHash })
  console.log(`client approve exact ${Number(budget) / 1e6} USDC   ${tx(approveHash)}`)
  const fundHash = await client.writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'fund', args: [jobId, '0x'] })
  await pub.waitForTransactionReceipt({ hash: fundHash })
  console.log(`client fund escrow   ${tx(fundHash)}`)

  // Wait for the agent to submit + arbiter to settle.
  for (let i = 0; i < 40; i++) {
    const s = Number((await getJob(jobId)).status)
    if (s === 3) {
      console.log(`✅ job #${jobId} COMPLETED — verified + settled`)
      return { jobId: jobId.toString(), outcome: 'completed' }
    }
    if (s === 4) {
      console.log(`❌ job #${jobId} REJECTED — refunded to client`)
      return { jobId: jobId.toString(), outcome: 'rejected' }
    }
    await sleep(4000)
  }
  console.log(`… job #${jobId} still pending (timed out)`)
  return { jobId: jobId.toString(), outcome: 'pending' }
}

const a = await run('JOB A — real enrichment (expect settle)', 'Enrich the wallet dataset: dedupe by address and risk-label each row.')
const b = await run('JOB B — tampered deliverable (expect reject + refund)', 'Enrich the wallet dataset: dedupe by address and risk-label each row. [BAD]')
console.log('\n=== SUMMARY ===')
console.log(JSON.stringify({ good: a, bad: b }, null, 2))
process.exit(0)
