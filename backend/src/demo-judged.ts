// Runs the two judged-quality demo jobs from the demo client wallet (never the
// arbiter). The backend worker (with LLM_API_KEY set) does the agent + arbiter
// LLM steps:
//   C — genuine analyst memo → arbiter judges against the spec → settle.
//   D — [LAZY] careless one-liner → arbiter judges → reject + refund.
// Both verdicts carry written reasoning whose keccak is committed onchain.
import 'dotenv/config'
import { createPublicClient, createWalletClient, decodeEventLog, http, parseAbi, zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { erc8183Abi } from './lib/abi.js'
import { ARBITER_ADDRESS, ARC_RPC, arcTestnet, ERC8183_ADDRESS, EXPLORER_URL, LIVE_AGENT_ADDRESS, USDC_ADDRESS } from './lib/config.js'

if (!process.env.LLM_API_KEY) {
  console.error('LLM_API_KEY is not set in backend/.env — judged demos need the free-tier key (the worker refuses to fabricate LLM work).')
  process.exit(1)
}
const key = process.env.DEMO_CLIENT_PRIVATE_KEY
if (!key) throw new Error('DEMO_CLIENT_PRIVATE_KEY not set in backend/.env')

const SPEC =
  'Produce a written risk-assessment memo on the provided wallet-activity dataset: methodology, findings for each risk band (low/medium/high) with concrete wallet references, at least three notable anomalies, and actionable recommendations for a treasury operator.'

const usdcAbi = parseAbi(['function approve(address spender, uint256 amount) returns (bool)'])
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

  const approveHash = await client.writeContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'approve', args: [ERC8183_ADDRESS, budget] })
  await pub.waitForTransactionReceipt({ hash: approveHash })
  console.log(`client approve exact ${Number(budget) / 1e6} USDC   ${tx(approveHash)}`)
  const fundHash = await client.writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'fund', args: [jobId, '0x'] })
  await pub.waitForTransactionReceipt({ hash: fundHash })
  console.log(`client fund escrow   ${tx(fundHash)}`)

  // LLM steps (memo + judgment) can take a little longer than deterministic ones.
  for (let i = 0; i < 60; i++) {
    const s = Number((await getJob(jobId)).status)
    if (s === 3) {
      console.log(`✅ job #${jobId} COMPLETED — judged pass, settled`)
      return { jobId: jobId.toString(), outcome: 'completed' }
    }
    if (s === 4) {
      console.log(`❌ job #${jobId} REJECTED — judged fail, refunded to client`)
      return { jobId: jobId.toString(), outcome: 'rejected' }
    }
    await sleep(5000)
  }
  console.log(`… job #${jobId} still pending (timed out)`)
  return { jobId: jobId.toString(), outcome: 'pending' }
}

const good = await run('JOB C — judged memo (expect pass + settle)', `[JUDGED] ${SPEC}`)
const lazy = await run('JOB D — lazy off-spec memo (expect fail + refund)', `[JUDGED] [LAZY] ${SPEC}`)

console.log('\n=== SUMMARY ===')
console.log(JSON.stringify({ judgedPass: good, judgedFail: lazy }, null, 2))
console.log(`job pages: http://localhost:5173/job/${good.jobId} · http://localhost:5173/job/${lazy.jobId}`)
process.exit(0)
