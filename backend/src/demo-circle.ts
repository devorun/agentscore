// A single "Circle-signed" job: a developer-controlled Circle Wallet acts as the
// agent (its OWN address) and signs setBudget + submit; the raw-key arbiter verifies
// the real deliverable and settles + attests. The proven raw-key agent (0x939A…) and
// every existing proof are left untouched. This exercises the SIGNER_MODE=circle
// adapter end to end.
//
// Prerequisites: SIGNER_MODE=circle in backend/.env, `npm run circle:setup` already
// run, the Circle wallet funded with gas USDC, and the demo-client funded. The
// backend worker should be idle (no raw-agent job in flight) to avoid arbiter-nonce
// contention. Run:  cd backend && SIGNER_MODE=circle npm run demo:circle
import 'dotenv/config'
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  keccak256,
  parseAbi,
  parseUnits,
  toHex,
  zeroAddress,
  type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { erc8183Abi, registryAbi } from './lib/abi.js'
import {
  ARBITER_ADDRESS,
  ARC_RPC,
  arcTestnet,
  ERC8183_ADDRESS,
  EXPLORER_URL,
  REGISTRY_ADDRESS,
  USDC_ADDRESS,
} from './lib/config.js'
import { enrich, hashOutput, loadInputDataset, verify } from './lib/enrichment.js'
import { getDeliverable, saveDeliverable, setVerdict } from './lib/store.js'
import { makeAgentSigner, rawSigner } from './lib/signer.js'

if ((process.env.SIGNER_MODE || 'raw').toLowerCase() !== 'circle') {
  console.error('Set SIGNER_MODE=circle to run the Circle-signed demo (this proves the developer-controlled wallet signs).')
  process.exit(1)
}
const clientKey = process.env.DEMO_CLIENT_PRIVATE_KEY
const arbiterKey = process.env.ARBITER_PRIVATE_KEY
if (!clientKey || !arbiterKey) throw new Error('DEMO_CLIENT_PRIVATE_KEY and ARBITER_PRIVATE_KEY must be set in backend/.env')

const PRICE_6 = parseUnits(process.env.CIRCLE_DEMO_PRICE_USDC || '1', 6)
const usdcAbi = parseAbi(['function approve(address spender, uint256 amount) returns (bool)'])
const pub = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC) })
const clientAccount = privateKeyToAccount(clientKey as `0x${string}`)
const client = createWalletClient({ account: clientAccount, chain: arcTestnet, transport: http(ARC_RPC) })
const tx = (h: string) => `${EXPLORER_URL}/tx/${h}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** The deliverable hash the provider actually submitted onchain (verified, not trusted). */
async function onchainDeliverable(jobId: bigint): Promise<`0x${string}` | undefined> {
  const head = await pub.getBlockNumber()
  const fromBlock = head > 9000n ? head - 9000n : 0n
  const ev = erc8183Abi.find((x) => x.type === 'event' && x.name === 'JobSubmitted')!
  const logs = await pub.getLogs({ address: ERC8183_ADDRESS, event: ev as never, args: { jobId } as never, fromBlock, toBlock: head })
  return (logs[0] as unknown as { args?: { deliverable?: `0x${string}` } })?.args?.deliverable
}

async function main() {
  const agent = await makeAgentSigner('0x00' as `0x${string}`) // SIGNER_MODE=circle → Circle wallet; raw key unused
  const arbiter = rawSigner(arbiterKey as `0x${string}`, 'arbiter (raw key)')
  console.log(`agent  = ${agent.label} @ ${agent.address}`)
  console.log(`arbiter= ${arbiter.label} @ ${arbiter.address}`)
  if (agent.address.toLowerCase() === '0x939abdd89fe9c5aac54615f56c50901acf5e6918') {
    throw new Error('refusing to run: agent resolved to the proven raw-key agent 0x939A… — check SIGNER_MODE / CIRCLE_AGENT_WALLET_ID')
  }

  // 1) Client creates the job with the CIRCLE wallet as provider.
  const description = 'Enrich the wallet dataset: dedupe by address and risk-label each row.'
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 3600)
  const createHash = await client.writeContract({
    address: ERC8183_ADDRESS,
    abi: erc8183Abi,
    functionName: 'createJob',
    args: [agent.address, ARBITER_ADDRESS, expiredAt, description, zeroAddress],
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
  console.log(`\nclient createJob → job #${jobId} (provider = Circle wallet)   ${tx(createHash)}`)

  // 2) Circle-signed agent sets the budget.
  const setBudgetHash = await agent.writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'setBudget', args: [jobId, PRICE_6, '0x'] })
  console.log(`agent setBudget ${Number(PRICE_6) / 1e6} USDC (Circle-signed)   ${tx(setBudgetHash)}`)

  // 3) Client approves the exact amount and funds escrow.
  const approveHash = await client.writeContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'approve', args: [ERC8183_ADDRESS, PRICE_6] })
  await pub.waitForTransactionReceipt({ hash: approveHash })
  const fundHash = await client.writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'fund', args: [jobId, '0x'] })
  await pub.waitForTransactionReceipt({ hash: fundHash })
  console.log(`client approve exact + fund escrow   ${tx(fundHash)}`)

  // 4) Circle-signed agent does the real work and submits the hash.
  const input = loadInputDataset()
  const output = enrich(input)
  const outputHash = hashOutput(output)
  saveDeliverable({
    jobId: jobId.toString(),
    producedBy: agent.address,
    spec: 'dedupe wallet dataset by address + risk-label each row',
    inputRows: input.length,
    output,
    outputHash,
    createdAt: Math.floor(Date.now() / 1000),
  })
  const submitHash = await agent.writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'submit', args: [jobId, outputHash, '0x'] })
  const rec = getDeliverable(jobId.toString())
  if (rec) {
    rec.submittedTx = submitHash
    saveDeliverable(rec)
  }
  console.log(`agent submit deliverable (${output.length} rows, Circle-signed)   ${tx(submitHash)}`)

  // 5) Raw-key arbiter verifies the real deliverable, then completes + attests.
  await sleep(2000)
  const onchainHash = (await onchainDeliverable(jobId)) ?? outputHash
  const result = verify(input, output, onchainHash)
  if (!result.ok) throw new Error(`arbiter verification failed unexpectedly: ${JSON.stringify(result.checks)}`)
  const reason = keccak256(toHex(`agentscore:verified:job-${jobId}`))
  const completeHash = await arbiter.writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'complete', args: [jobId, reason, '0x'] })
  console.log(`arbiter VERIFIED (${result.gotRowCount} rows, checksum ✓) — complete (raw-key)   ${tx(completeHash)}`)
  const attestHash = await arbiter.writeContract({ address: REGISTRY_ADDRESS as Address, abi: registryAbi, functionName: 'attest', args: [jobId, agent.address, 0, reason] })
  setVerdict(jobId.toString(), { outcome: 'approved', checks: result.checks, expectedRowCount: result.expectedRowCount, gotRowCount: result.gotRowCount, verifiedAt: Math.floor(Date.now() / 1000), settleTx: completeHash })
  console.log(`arbiter attest APPROVED (raw-key)   ${tx(attestHash)}`)

  console.log('\n=== CIRCLE-SIGNED JOB SETTLED ===')
  console.log(`job #${jobId}: Circle wallet ${agent.address} signed setBudget + submit; raw-key arbiter verified + released ${Number(PRICE_6) / 1e6} USDC.`)
  console.log(`setBudget (Circle): ${tx(setBudgetHash)}`)
  console.log(`submit (Circle):    ${tx(submitHash)}`)
  console.log(`complete (arbiter): ${tx(completeHash)}`)
  console.log(`job page: http://localhost:5173/job/${jobId}`)
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('demo-circle error:', (e as Error).message ?? e)
  process.exit(1)
})
