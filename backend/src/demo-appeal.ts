// Appeals demo (Item 2) — fully self-contained on THROWAWAY keys (demo client,
// PRIME_AGENT provider, DEMO_ARBITER evaluator, APPEAL_ARBITER), never the live
// worker's Lexica/arbiter keys, so it never collides with the cloud cron.
//
// Two judged jobs, both REJECTED by an over-strict first arbiter (family A,
// gpt-oss), then re-adjudicated by an INDEPENDENT appeal arbiter on a DIFFERENT
// model family (family B) from the stored deliverable + onchain record:
//   A — a genuinely careless memo  → appeal agrees → UPHELD.
//   B — a substantially-good memo the first arbiter rejected → appeal → OVERTURNED.
// Both appeal outcomes are attested onchain to AgentScoreAppeals. Every verdict
// and appeal carries real LLM reasoning whose keccak is committed onchain.
import 'dotenv/config'
import { createPublicClient, createWalletClient, decodeEventLog, http, keccak256, parseAbi, parseUnits, toHex, zeroAddress, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { erc8183Abi } from './lib/abi.js'
import { APPEALS_ADDRESS, ARC_RPC, arcTestnet, ERC8183_ADDRESS, EXPLORER_URL, USDC_ADDRESS } from './lib/config.js'
import { ARBITER_MODEL, RUBRIC_CRITERIA, agentWriteMemo, chat, parseJudgeJson, reasonHashOf } from './lib/judged.js'
import { appealJudge, resolveAppealOnchain } from './lib/appeal.js'
import { loadInputDataset } from './lib/enrichment.js'
import { getDeliverable, saveDeliverable, setAppeal, setVerdict } from './lib/store.js'
import { computeReputation } from './lib/reputation.js'

if (!process.env.LLM_API_KEY) {
  console.error('LLM_API_KEY not set — the appeal demo makes real LLM judgments and never fabricates a verdict.')
  process.exit(1)
}
const need = (n: string): Hex => {
  const v = process.env[n]
  if (!v) throw new Error(`${n} not set in backend/.env (run node tmp_appeal_keys.mjs to generate)`)
  return (v.startsWith('0x') ? v : `0x${v}`) as Hex
}

const SPEC =
  'Produce a written risk-assessment memo on the provided wallet-activity dataset: methodology, findings for each risk band (low/medium/high) with concrete wallet references, at least three notable anomalies, and actionable recommendations for a treasury operator.'
const PRICE = parseUnits('2', 6)
const usdcAbi = parseAbi(['function approve(address spender, uint256 amount) returns (bool)', 'function transfer(address to, uint256 amount) returns (bool)'])

const client = privateKeyToAccount(need('DEMO_CLIENT_PRIVATE_KEY'))
const agent = privateKeyToAccount(need('PRIME_AGENT_PRIVATE_KEY'))
const orig = privateKeyToAccount(need('DEMO_ARBITER_PRIVATE_KEY'))
const appeal = privateKeyToAccount(need('APPEAL_ARBITER_PRIVATE_KEY'))

const pub = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC) })
const wc = (a: typeof client) => createWalletClient({ account: a, chain: arcTestnet, transport: http(ARC_RPC) })
const tx = (h: string) => `${EXPLORER_URL}/tx/${h}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function confirm(hash: Hex) { await pub.waitForTransactionReceipt({ hash }); return hash }

/** Top up gas (native USDC) for the throwaway signers so they can send. */
async function fundGas(to: `0x${string}`, min: string, top: string) {
  const bal = await pub.getBalance({ address: to })
  if (bal >= parseUnits(min, 18)) return
  const h = await wc(client).writeContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'transfer', args: [to, parseUnits(top, 6)] })
  await confirm(h)
  console.log(`  funded ${to} with ${top} USDC gas`)
}

/** An over-strict first arbiter (family A): pass only if the memo is flawless.
 * A real LLM judgment — it just applies an unreasonably high bar, the kind of
 * miscalibration appeals exist to correct. */
async function strictFirstArbiter(memo: string) {
  const dataset = JSON.stringify(loadInputDataset())
  const prompt =
    `You are a STRICT first-pass arbiter for onchain agent work. Evaluate the DELIVERABLE against the JOB SPEC. ` +
    `Do not redo the work; judge only what was delivered. Score each criterion 0-10 with a one-sentence comment: ` +
    `${RUBRIC_CRITERIA.join('; ')}. Apply a very high bar: set "pass" true ONLY IF every criterion is a 9 or 10 ` +
    `(flawless, publication-ready); otherwise "pass" is false. Reply with ONLY this JSON, no code fences:\n` +
    `{"rubric":[{"criterion":"...","score":0,"max":10,"comment":"..."}],"pass":false,"reasoning":"plain sentences, at most 100 words"}\n\n` +
    `JOB SPEC: ${SPEC}\n\nREFERENCE DATASET (JSON): ${dataset}\n\nDELIVERABLE:\n${memo}`
  const raw = await chat(ARBITER_MODEL, prompt, 1400)
  const parsed = parseJudgeJson(raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim())
  return { ...parsed, reasonHash: reasonHashOf(parsed.reasoning) }
}

async function runJob(label: string, lazy: boolean) {
  console.log(`\n=== ${label} ===`)
  // 1. client creates the job (provider = agent, evaluator = first arbiter)
  const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 3600)
  const createHash = await wc(client).writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'createJob', args: [agent.address, orig.address, expiredAt, SPEC, zeroAddress] })
  const receipt = await pub.waitForTransactionReceipt({ hash: createHash })
  let jobId = 0n
  for (const lg of receipt.logs) {
    try {
      const d = decodeEventLog({ abi: erc8183Abi, topics: lg.topics, data: lg.data })
      if (d.eventName === 'JobCreated') { jobId = (d.args as { jobId: bigint }).jobId; break }
    } catch { /* not this event */ }
  }
  console.log(`client createJob → job #${jobId}   ${tx(createHash)}`)

  // 2. agent prices, 3. client funds
  await confirm(await wc(agent).writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'setBudget', args: [jobId, PRICE, '0x'] }))
  await confirm(await wc(client).writeContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'approve', args: [ERC8183_ADDRESS, PRICE] }))
  await confirm(await wc(client).writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'fund', args: [jobId, '0x'] }))
  console.log(`agent priced ${Number(PRICE) / 1e6} USDC · client funded escrow`)

  // 4. agent writes a real memo and submits its hash
  const { memo, model } = await agentWriteMemo(SPEC, lazy)
  const outputHash = keccak256(toHex(memo))
  saveDeliverable({ jobId: jobId.toString(), kind: 'judged', producedBy: agent.address, spec: SPEC, inputRows: loadInputDataset().length, output: [], memo, agentModel: model, outputHash, createdAt: Math.floor(Date.now() / 1000) })
  const submitHash = await confirm(await wc(agent).writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'submit', args: [jobId, outputHash, '0x'] }))
  const rec0 = getDeliverable(jobId.toString())!; rec0.submittedTx = submitHash; saveDeliverable(rec0)
  console.log(`agent submitted memo (${memo.length} chars by ${model}${lazy ? ', careless' : ''})`)

  // 5. FIRST arbiter (strict, family A) genuinely judges → rejects → onchain reject
  const first = await strictFirstArbiter(memo)
  if (first.pass) { console.log(`⚠ strict first arbiter PASSED job #${jobId} — no rejection to appeal; skipping`); return null }
  const rejectHash = await confirm(await wc(orig).writeContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'reject', args: [jobId, first.reasonHash, '0x'] }))
  setVerdict(jobId.toString(), { outcome: 'rejected', rubric: first.rubric, reasoning: first.reasoning, reasonHash: first.reasonHash, arbiterModel: ARBITER_MODEL, deliverableHashMatch: true, verifiedAt: Math.floor(Date.now() / 1000), settleTx: rejectHash })
  console.log(`first arbiter (${ARBITER_MODEL}) REJECTED → ${tx(rejectHash)}`)

  // 6. APPEAL arbiter (family B) independently re-adjudicates → attest onchain
  const verdict = await appealJudge(SPEC, memo, 'rejected')
  const result = verdict.pass ? 'approved' : 'rejected'
  const attestTx = await resolveAppealOnchain(jobId, agent.address, 'rejected', result, verdict.reasonHash)
  setAppeal(jobId.toString(), { filedBy: agent.address, appealArbiter: appeal.address, appealModel: verdict.appealModel, original: 'rejected', result, overturned: result === 'approved', rubric: verdict.rubric, reasoning: verdict.reasoning, reasonHash: verdict.reasonHash, attestTx, resolvedAt: Math.floor(Date.now() / 1000) })
  console.log(`appeal arbiter (${verdict.appealModel}) → ${result.toUpperCase()} (${result === 'approved' ? 'OVERTURNED' : 'UPHELD'})   ${tx(attestTx)}`)
  return { jobId: jobId.toString(), original: 'rejected', result, overturned: result === 'approved' }
}

// --- run --------------------------------------------------------------------
console.log('funding throwaway signers (gas) from the demo client…')
await fundGas(orig.address, '0.2', '1')
await fundGas(appeal.address, '0.2', '1')

const upheld = await runJob('JOB A — careless memo (expect UPHELD)', true)
await sleep(1500)
const overturned = await runJob('JOB B — good memo wrongly rejected (expect OVERTURNED)', false)

console.log('\n=== reputation fold (agent) ===')
const rep = await computeReputation(agent.address)
console.log(`agent ${agent.address}: score=${rep.score}, rejections counted=${rep.metrics.rejected}, overturned (not penalized)=${rep.overturnedRejections}`)

console.log('\n=== SUMMARY ===')
console.log(JSON.stringify({ appealsContract: APPEALS_ADDRESS, upheld, overturned }, null, 2))
if (upheld) console.log(`job page: http://localhost:5173/job/${upheld.jobId}`)
if (overturned) console.log(`job page: http://localhost:5173/job/${overturned.jobId}`)
process.exit(0)
