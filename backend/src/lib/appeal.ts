// Appeals — a second, INDEPENDENT arbiter re-adjudicates a contested verdict on a
// DIFFERENT model family (no self-grading, no deference to the first arbiter),
// judging from the onchain record and the stored deliverable. The outcome is
// attested onchain to AgentScoreAppeals — never the registry, whose verdicts are
// final and one-per-job. It never moves ERC-8183 escrow (settlement there is
// final); it corrects the reputation record. Same honesty rules as judged.ts: a
// missing key or a provider failure throws LOUDLY; an appeal is never fabricated.
import { createWalletClient, decodeEventLog, getAddress, http, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { publicClient } from './chain.js'
import { appealsAbi } from './abi.js'
import { APPEALS_ADDRESS, ARC_RPC, arcTestnet } from './config.js'
import { fetchLogsByTopic, padAddressTopic } from './explorer.js'
import { loadInputDataset } from './enrichment.js'
import { chat, parseJudgeJson, reasonHashOf, RUBRIC_CRITERIA, type JudgeResult } from './judged.js'

// A THIRD model family on purpose: different from the agent's writer
// (llama-3.3-70b) and from the original arbiter (openai/gpt-oss-120b).
export const APPEAL_MODEL = process.env.APPEAL_LLM_MODEL || 'qwen/qwen3.6-27b'

export type OutcomeStr = 'approved' | 'rejected'
const toEnum = (o: OutcomeStr): number => (o === 'rejected' ? 1 : 0)
const fromEnum = (n: number | bigint): OutcomeStr => (Number(n) === 1 ? 'rejected' : 'approved')

/** The appeal arbiter's independent re-evaluation on a different model family. */
export async function appealJudge(
  spec: string,
  memo: string,
  original: OutcomeStr,
): Promise<JudgeResult & { appealModel: string; reasonHash: Hex }> {
  const dataset = JSON.stringify(loadInputDataset())
  const prompt =
    `You are an independent APPEAL arbiter for onchain agent work, reviewing a CONTESTED verdict. ` +
    `A first arbiter (a different model) ruled this deliverable ${original.toUpperCase()}. ` +
    `Re-evaluate the DELIVERABLE against the JOB SPEC independently and from scratch — do NOT defer to the first ` +
    `arbiter, and do NOT redo the work; judge only what was delivered. Score each criterion 0-10 with a one-sentence ` +
    `comment: ${RUBRIC_CRITERIA.join('; ')}. Set "pass" true only if the deliverable substantially fulfils the spec. ` +
    `Reply with ONLY this JSON, no code fences:\n` +
    `{"rubric":[{"criterion":"...","score":0,"max":10,"comment":"..."}],"pass":false,"reasoning":"plain sentences, at most 100 words"}\n\n` +
    `JOB SPEC: ${spec}\n\nREFERENCE DATASET (JSON): ${dataset}\n\nDELIVERABLE:\n${memo}`
  // Generous budget: the appeal model is a reasoning model, so it needs room to
  // think AND still emit the full JSON verdict without truncation.
  const raw = await chat(APPEAL_MODEL, prompt, 4000)
  const parsed = parseJudgeJson(lastJsonObject(raw))
  return { ...parsed, appealModel: APPEAL_MODEL, reasonHash: reasonHashOf(parsed.reasoning) }
}

/** Extract the last complete, brace-balanced JSON object from a model reply.
 * Reasoning models emit <think>…</think> (which itself contains braces) before
 * the answer, so a naive first-`{`-to-last-`}` slice is not valid JSON. */
export function lastJsonObject(raw: string): string {
  const s = raw.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const end = s.lastIndexOf('}')
  if (end < 0) return s.trim()
  let depth = 0
  for (let i = end; i >= 0; i--) {
    if (s[i] === '}') depth++
    else if (s[i] === '{' && --depth === 0) return s.slice(i, end + 1)
  }
  return s.trim()
}

/** Attest the appeal outcome onchain, signed by the independent appeal arbiter. */
export async function resolveAppealOnchain(
  jobId: bigint,
  agent: Address,
  original: OutcomeStr,
  result: OutcomeStr,
  reasonHash: Hex,
): Promise<Hex> {
  const key = process.env.APPEAL_ARBITER_PRIVATE_KEY
  if (!key) throw new Error('APPEAL_ARBITER_PRIVATE_KEY missing — cannot attest the appeal outcome onchain')
  const account = privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as Hex)
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(ARC_RPC) })
  const hash = await wallet.writeContract({
    address: APPEALS_ADDRESS,
    abi: appealsAbi,
    functionName: 'resolveAppeal',
    args: [jobId, getAddress(agent), toEnum(original), toEnum(result), reasonHash],
    account,
    chain: arcTestnet,
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}

export interface OnchainAppeal {
  jobId: string
  agent: Address
  original: OutcomeStr
  result: OutcomeStr
  overturned: boolean
  reasonHash: string
  appealArbiter: Address
  resolvedAt: number
}

/** The onchain appeal for a job, if one has been recorded. */
export async function getOnchainAppeal(jobId: bigint): Promise<OnchainAppeal | null> {
  const appealed = (await publicClient
    .readContract({ address: APPEALS_ADDRESS, abi: appealsAbi, functionName: 'jobAppealed', args: [jobId] })
    .catch(() => false)) as boolean
  if (!appealed) return null
  const a = (await publicClient.readContract({
    address: APPEALS_ADDRESS,
    abi: appealsAbi,
    functionName: 'getAppeal',
    args: [jobId],
  })) as { jobId: bigint; agent: Address; original: number; result: number; reasonHash: string; appealArbiter: Address; resolvedAt: bigint }
  const original = fromEnum(a.original)
  const result = fromEnum(a.result)
  return {
    jobId: a.jobId.toString(),
    agent: getAddress(a.agent),
    original,
    result,
    overturned: original !== result,
    reasonHash: a.reasonHash,
    appealArbiter: getAddress(a.appealArbiter),
    resolvedAt: Number(a.resolvedAt),
  }
}

/** Job ids where THIS agent had a rejection overturned on appeal (original =
 * Rejected, result = Approved). Reputation reads this to stop penalizing them. */
export async function fetchOverturnedRejections(agent: Address): Promise<Set<string>> {
  const logs = await fetchLogsByTopic(APPEALS_ADDRESS, 2, padAddressTopic(getAddress(agent))).catch(() => [])
  const out = new Set<string>()
  for (const l of logs) {
    try {
      const { eventName, args } = decodeEventLog({ abi: appealsAbi, topics: l.topics as [Hex, ...Hex[]], data: l.data })
      if (eventName !== 'AppealResolved') continue
      const a = args as unknown as { jobId: bigint; original: number; result: number }
      if (Number(a.original) === 1 && Number(a.result) === 0) out.add(a.jobId.toString())
    } catch {
      /* unrelated log shape — skip */
    }
  }
  return out
}
