// Demonstrates the Circle Nanopayments rail on a real job, ALONGSIDE the ERC-8183
// escrow (which stays the settlement of record). Creates a job (or reuses one passed
// as argv[2]), lets the backend worker run the escrow loop, then meters one micro-USDC
// payment per enriched row over Circle Gateway and has the agent withdraw accrued
// earnings on-chain. Requires NANOPAY_ENABLED=1 and the backend worker running.
//   Usage:  npm run demo:nanopay            (creates a fresh job)
//           npm run demo:nanopay -- 158648  (reuses an existing job id)
import 'dotenv/config'
import { createPublicClient, createWalletClient, decodeEventLog, http, parseAbi, zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { erc8183Abi } from './lib/abi.js'
import {
  ARBITER_ADDRESS,
  ARC_RPC,
  arcTestnet,
  ERC8183_ADDRESS,
  EXPLORER_URL,
  LIVE_AGENT_ADDRESS,
  NANOPAY_ENABLED,
  USDC_ADDRESS,
} from './lib/config.js'
import { enrich, loadInputDataset } from './lib/enrichment.js'
import { meterJobRows, withdrawEarnings } from './lib/nanopay.js'
import { getNanopay } from './lib/store.js'

if (!NANOPAY_ENABLED) {
  console.error('NANOPAY_ENABLED is not set — set NANOPAY_ENABLED=1 in backend/.env to run this demo.')
  process.exit(1)
}

const key = process.env.DEMO_CLIENT_PRIVATE_KEY
if (!key) throw new Error('DEMO_CLIENT_PRIVATE_KEY not set in backend/.env')

const usdcAbi = parseAbi(['function approve(address spender, uint256 amount) returns (bool)'])
const account = privateKeyToAccount(key as `0x${string}`)
const pub = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC) })
const client = createWalletClient({ account, chain: arcTestnet, transport: http(ARC_RPC) })
const tx = (h: string) => `${EXPLORER_URL}/tx/${h}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const getJob = (id: bigint) => pub.readContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'getJob', args: [id] })

async function createAndSettle(): Promise<bigint> {
  const description = 'Enrich the wallet dataset: dedupe by address and risk-label each row.'
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
  console.log(`agent set escrow price: ${Number(budget) / 1e6} USDC (ERC-8183 — settlement of record)`)

  const approveHash = await client.writeContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'approve', args: [ERC8183_ADDRESS, budget] })
  await pub.waitForTransactionReceipt({ hash: approveHash })
  const fundHash = await client.writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'fund', args: [jobId, '0x'] })
  await pub.waitForTransactionReceipt({ hash: fundHash })
  console.log(`client approve exact + fund escrow   ${tx(fundHash)}`)

  for (let i = 0; i < 45; i++) {
    const s = Number((await getJob(jobId)).status)
    if (s === 3) {
      console.log(`✅ escrow job #${jobId} COMPLETED — verified + settled`)
      return jobId
    }
    if (s === 4) {
      console.log(`❌ escrow job #${jobId} REJECTED — refunded`)
      return jobId
    }
    await sleep(4000)
  }
  console.log(`… escrow job #${jobId} still pending (continuing to nanopayments)`)
  return jobId
}

const argJob = process.argv[2]
const jobId = argJob ? BigInt(argJob) : await createAndSettle()

// Per-row metering is driven by the REAL enrichment output row count.
const rows = enrich(loadInputDataset()).length
console.log(`\n=== Circle Nanopayments — ${rows} rows @ micro-USDC, alongside the escrow ===`)
await meterJobRows(jobId.toString(), rows, { depositMode: 'force' })
console.log('agent withdrawing accrued earnings on-chain (same-chain instant mint)…')
await withdrawEarnings(jobId.toString())

const led = getNanopay(jobId.toString())
console.log('\n=== NANOPAYMENTS LEDGER ===')
if (led) {
  console.log(`job #${led.jobId}: ${led.rows.length} rows, total ${led.totalPaidUsdc} USDC — off-chain, batched by Gateway`)
  if (led.depositTx) console.log(`on-chain deposit:       ${tx(led.depositTx)}`)
  if (led.withdrawMintTx) console.log(`on-chain withdraw-mint: ${tx(led.withdrawMintTx)}  (${led.withdrawAmountUsdc} USDC)`)
  console.log(`job page: http://localhost:5173/job/${led.jobId}`)
} else {
  console.log('no ledger produced')
}
process.exit(0)
