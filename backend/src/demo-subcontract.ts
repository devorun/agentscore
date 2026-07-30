// Agent-to-agent subcontracting demo (Item 3) — one full live chain on-chain,
// on THROWAWAY keys only (demo client, PRIME_AGENT = prime, a generated
// SPECIALIST_AGENT, DEMO_ARBITER = evaluator) — never the worker's Lexica/arbiter
// keys, so the cloud cron is untouched.
//
//   client → hires PRIME (main job, 5 USDC escrow)
//   PRIME  → subcontracts the risk-scoring slice to SPECIALIST (sub job, 2 USDC),
//            funding that escrow FROM ITS OWN BALANCE
//   SPECIALIST delivers → arbiter verifies → SPECIALIST paid from PRIME's funds
//   PRIME delivers the combined report → arbiter verifies → PRIME paid by client
// Net: PRIME keeps its margin; both jobs are linked onchain via [SUBCONTRACT main].
import 'dotenv/config'
import { appendFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, decodeEventLog, formatUnits, http, keccak256, parseAbi, parseUnits, toHex, zeroAddress, type Hex } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { erc8183Abi } from './lib/abi.js'
import { ARC_RPC, arcTestnet, ERC8183_ADDRESS, EXPLORER_URL, USDC_ADDRESS } from './lib/config.js'
import { enrich, hashOutput, loadInputDataset, verify, type WalletRow } from './lib/enrichment.js'
import { saveDeliverable, addSubcontract, getDeliverable } from './lib/store.js'
import { subcontractMarker } from './lib/subcontract.js'

const need = (n: string): Hex => {
  const v = process.env[n]
  if (!v) throw new Error(`${n} not set in backend/.env`)
  return (v.startsWith('0x') ? v : `0x${v}`) as Hex
}
function ensureKey(n: string): Hex {
  if (process.env[n]) return need(n)
  const pk = generatePrivateKey()
  appendFileSync(new URL('./.env', import.meta.url), `\n# Subcontracting (Item 3) — testnet only, never commit\n${n}=${pk}\n`)
  return pk
}

const MAIN_SPEC = 'Deliver a full wallet-risk report: dedupe the dataset, risk-label every wallet, and summarize the high-risk cohort for a treasury operator.'
const SUB_SPEC = 'Risk-label each wallet in the dataset (low/medium/high) — the risk-scoring slice of the report.'
const MAIN_PRICE = parseUnits('5', 6)
const SUB_PRICE = parseUnits('2', 6)
const usdcAbi = parseAbi(['function approve(address,uint256) returns (bool)', 'function transfer(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)'])

const client = privateKeyToAccount(need('DEMO_CLIENT_PRIVATE_KEY'))
const prime = privateKeyToAccount(need('PRIME_AGENT_PRIVATE_KEY'))
const specialist = privateKeyToAccount(ensureKey('SPECIALIST_AGENT_PRIVATE_KEY'))
const arbiter = privateKeyToAccount(need('DEMO_ARBITER_PRIVATE_KEY'))

const pub = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC) })
const wc = (a: typeof client) => createWalletClient({ account: a, chain: arcTestnet, transport: http(ARC_RPC) })
const tx = (h: string) => `${EXPLORER_URL}/tx/${h}`
const confirm = async (h: Hex) => { await pub.waitForTransactionReceipt({ hash: h }); return h }
const usdcBal = (a: `0x${string}`) => pub.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'balanceOf', args: [a] }) as Promise<bigint>
const jobStatus = async (id: bigint) => Number((await pub.readContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'getJob', args: [id] }) as { status: number }).status)

async function fundGas(to: `0x${string}`, min: string, top: string) {
  if ((await pub.getBalance({ address: to })) >= parseUnits(min, 18)) return
  await confirm(await wc(client).writeContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'transfer', args: [to, parseUnits(top, 6)] }))
  console.log(`  funded ${to} with ${top} USDC`)
}

async function createJob(signer: typeof client, provider: `0x${string}`, description: string): Promise<bigint> {
  const r = await pub.waitForTransactionReceipt({
    hash: await wc(signer).writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'createJob', args: [provider, arbiter.address, BigInt(Math.floor(Date.now() / 1000) + 3600), description, zeroAddress] }),
  })
  for (const lg of r.logs) {
    try {
      const d = decodeEventLog({ abi: erc8183Abi, topics: lg.topics, data: lg.data })
      if (d.eventName === 'JobCreated') return (d.args as { jobId: bigint }).jobId
    } catch { /* not this event */ }
  }
  throw new Error('JobCreated not found')
}

/** provider prices, funder approves + funds. Returns the fund tx. */
async function priceAndFund(jobId: bigint, provider: typeof client, funder: typeof client, price: bigint): Promise<Hex> {
  await confirm(await wc(provider).writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'setBudget', args: [jobId, price, '0x'] }))
  await confirm(await wc(funder).writeContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'approve', args: [ERC8183_ADDRESS, price] }))
  return confirm(await wc(funder).writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'fund', args: [jobId, '0x'] }))
}

/** provider does real enrichment work + submits its hash. */
async function deliver(jobId: bigint, provider: typeof client): Promise<Hex> {
  const output = enrich(loadInputDataset() as WalletRow[])
  const outputHash = hashOutput(output)
  saveDeliverable({ jobId: jobId.toString(), producedBy: provider.address, spec: provider === specialist ? SUB_SPEC : MAIN_SPEC, inputRows: loadInputDataset().length, output, outputHash, createdAt: Math.floor(Date.now() / 1000) })
  const h = await confirm(await wc(provider).writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'submit', args: [jobId, outputHash, '0x'] }))
  const rec = getDeliverable(jobId.toString())!; rec.submittedTx = h; saveDeliverable(rec)
  return h
}

/** arbiter re-derives the work, verifies the submitted hash, and settles. */
async function verifyAndComplete(jobId: bigint): Promise<Hex> {
  const input = loadInputDataset() as WalletRow[]
  const result = verify(input, enrich(input), hashOutput(enrich(input)))
  if (!result.ok) throw new Error(`verification failed for #${jobId}`)
  const reason = keccak256(toHex(`agentscore:verified:job-${jobId}`))
  const h = await confirm(await wc(arbiter).writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'complete', args: [jobId, reason, '0x'] }))
  const rec = getDeliverable(jobId.toString())
  if (rec) { rec.verdict = { outcome: 'approved', verifiedAt: Math.floor(Date.now() / 1000), settleTx: h }; saveDeliverable(rec) }
  return h
}

// --- run --------------------------------------------------------------------
console.log('funding throwaway signers (gas)…')
await fundGas(specialist.address, '0.2', '1')
await fundGas(arbiter.address, '0.2', '0.5')

console.log('\n=== MAIN JOB: client hires PRIME ===')
const mainId = await createJob(client, prime.address, MAIN_SPEC)
console.log(`client createJob → main #${mainId}`)
await priceAndFund(mainId, prime, client, MAIN_PRICE)
console.log(`PRIME priced ${Number(MAIN_PRICE) / 1e6} USDC · client funded escrow`)

const primeBefore = await usdcBal(prime.address)
console.log('\n=== SUBCONTRACT: PRIME hires SPECIALIST, funding from its own balance ===')
const subId = await createJob(prime, specialist.address, `${subcontractMarker(mainId)} ${SUB_SPEC}`)
console.log(`PRIME createJob → sub #${subId}  (onchain description links to main #${mainId})`)
const fundedTx = await priceAndFund(subId, specialist, prime, SUB_PRICE)
console.log(`SPECIALIST priced ${Number(SUB_PRICE) / 1e6} USDC · PRIME funded it   ${tx(fundedTx)}`)

console.log('\n=== SPECIALIST delivers → arbiter verifies → SPECIALIST paid ===')
await deliver(subId, specialist)
const subSettleTx = await verifyAndComplete(subId)
console.log(`sub #${subId} status=${['open','funded','submitted','completed','rejected','expired'][await jobStatus(subId)]}   ${tx(subSettleTx)}`)

console.log('\n=== PRIME delivers the combined report → arbiter verifies → PRIME paid by client ===')
await deliver(mainId, prime)
const mainSettleTx = await verifyAndComplete(mainId)
// Record the subcontract on the main deliverable (now that it exists).
addSubcontract(mainId.toString(), { jobId: subId.toString(), specialist: specialist.address, part: SUB_SPEC, budgetUsdc: '2', fundedTx, settledTx: subSettleTx })
console.log(`main #${mainId} status=${['open','funded','submitted','completed','rejected','expired'][await jobStatus(mainId)]}   ${tx(mainSettleTx)}`)

const primeAfter = await usdcBal(prime.address)
const specialistBal = await usdcBal(specialist.address)
console.log('\n=== ECONOMICS (USDC) ===')
console.log(`PRIME balance before subcontract: ${formatUnits(primeBefore, 6)}  →  after main settled: ${formatUnits(primeAfter, 6)}  (paid the specialist 2 from its own funds, earned its margin from the client)`)
console.log(`SPECIALIST balance: ${formatUnits(specialistBal, 6)} (earned its subcontract fee)`)
console.log('\n=== SUMMARY ===')
console.log(JSON.stringify({ mainJob: mainId.toString(), subJob: subId.toString(), specialist: specialist.address, prime: prime.address }, null, 2))
console.log(`job pages: http://localhost:5173/job/${mainId}  ·  http://localhost:5173/job/${subId}`)
process.exit(0)
