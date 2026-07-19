// Judged-quality jobs — the second verification model alongside deterministic
// re-derivation. The agent produces genuine LLM work (an analyst memo) and the
// arbiter EVALUATES it against the job spec with its own LLM call on a DIFFERENT
// model family (no self-grading), scoring a rubric and writing a reason. The
// arbiter never re-derives the work; its only deterministic check is integrity
// (the stored memo must hash to the onchain submission).
//
// Honesty rules (binding): $0 — Groq free tier only. If the key is missing or
// the provider fails/rate-limits, throw LOUDLY and leave the job untouched for
// the next cycle. A verdict is NEVER fabricated.
import { keccak256, toHex } from 'viem'
import { loadInputDataset } from './enrichment.js'

export const AGENT_MODEL = process.env.AGENT_LLM_MODEL || 'llama-3.3-70b-versatile'
export const ARBITER_MODEL = process.env.ARBITER_LLM_MODEL || 'openai/gpt-oss-120b'
const API_URL = process.env.LLM_API_URL || 'https://api.groq.com/openai/v1/chat/completions'

export function llmKeyPresent(): boolean {
  return Boolean(process.env.LLM_API_KEY)
}

// Job-type detection from the onchain description. [JUDGED] marks a
// judged-quality job; [LAZY] additionally makes the agent produce a deliberately
// careless deliverable (the reject demo — a real LLM output that genuinely fails
// the rubric, mirroring the deterministic path's tampered run).
export function isJudgedJob(description: string): boolean {
  return /\[JUDGED\]/i.test(description)
}
export function isLazyRun(description: string): boolean {
  return /\[LAZY\]/i.test(description)
}
export function judgedSpec(description: string): string {
  return description.replace(/\[JUDGED\]|\[LAZY\]/gi, '').replace(/\s+/g, ' ').trim()
}

/** keccak of the arbiter's actual written reasoning — committed onchain as the
 * settle/attest reason, so the displayed reasoning is verifiably the attested one. */
export function reasonHashOf(reasoning: string): `0x${string}` {
  return keccak256(toHex(reasoning))
}

export interface RubricItem {
  criterion: string
  score: number
  max: number
  comment: string
}
export interface JudgeResult {
  pass: boolean
  reasoning: string
  rubric: RubricItem[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One chat call. Retries 429/5xx with backoff, then throws — loud by design. */
async function chat(model: string, prompt: string, maxTokens: number): Promise<string> {
  const key = process.env.LLM_API_KEY
  if (!key) throw new Error('LLM_API_KEY missing — judged jobs require the free-tier key; refusing to fabricate output')
  let lastError = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(4000 * attempt)
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, temperature: 0, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    })
    if (res.status === 429 || res.status >= 500) {
      lastError = `provider ${res.status} (rate limit or transient)`
      continue
    }
    if (!res.ok) throw new Error(`LLM provider responded ${res.status}`)
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const content = json.choices?.[0]?.message?.content?.trim()
    if (!content) throw new Error('LLM returned an empty completion')
    return content
  }
  throw new Error(`LLM unavailable after retries: ${lastError} — leaving job for the next cycle (no fabricated verdict)`)
}

/** The agent's real work: a grounded analyst memo per the spec (or a genuinely
 * careless one-liner when lazy — the honest bad-deliverable for the reject demo). */
export async function agentWriteMemo(spec: string, lazy: boolean): Promise<{ memo: string; model: string }> {
  const dataset = JSON.stringify(loadInputDataset())
  const prompt = lazy
    ? `You are a careless analyst. Ignore the spec below. Reply with exactly one short, vague sentence about the dataset and nothing else.\n\nSpec: ${spec}\n\nDataset (JSON): ${dataset}`
    : `You are Lexica, an onchain risk-analyst agent. Produce the deliverable specified below as a concise markdown memo (at most ~450 words) with clear section headings. Ground every claim in the dataset — cite concrete wallet addresses and numbers from it. Output the memo only, no preamble.\n\nSpec: ${spec}\n\nDataset (JSON): ${dataset}`
  const memo = await chat(AGENT_MODEL, prompt, 1000)
  return { memo, model: AGENT_MODEL }
}

export const RUBRIC_CRITERIA = ['Spec compliance', 'Grounding in the dataset', 'Completeness', 'Actionability'] as const

/** The arbiter's real evaluation: judge the deliverable against the spec —
 * never redo the work. Strict JSON out; anything malformed throws (no verdict). */
export async function arbiterJudge(spec: string, memo: string): Promise<JudgeResult & { arbiterModel: string; reasonHash: `0x${string}` }> {
  const dataset = JSON.stringify(loadInputDataset())
  const prompt =
    `You are an independent arbiter for onchain agent work. Evaluate the DELIVERABLE against the JOB SPEC. ` +
    `Do not redo or re-derive the work — judge only what was delivered. Score each criterion 0-10 with a one-sentence comment: ` +
    `${RUBRIC_CRITERIA.join('; ')}. Set "pass" true only if the deliverable substantially fulfils the spec. ` +
    `Reply with ONLY this JSON, no code fences:\n` +
    `{"rubric":[{"criterion":"...","score":0,"max":10,"comment":"..."}],"pass":false,"reasoning":"plain sentences, at most 100 words"}\n\n` +
    `JOB SPEC: ${spec}\n\nREFERENCE DATASET (JSON): ${dataset}\n\nDELIVERABLE:\n${memo}`
  const raw = await chat(ARBITER_MODEL, prompt, 1400)
  const parsed = parseJudgeJson(raw)
  return { ...parsed, arbiterModel: ARBITER_MODEL, reasonHash: reasonHashOf(parsed.reasoning) }
}

/** Parse + validate the judge's JSON. Throws on anything malformed — the caller
 * must treat that as "no verdict this cycle", never as a pass or a fail. */
export function parseJudgeJson(raw: string): JudgeResult {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('judge returned no JSON object')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    throw new Error('judge returned invalid JSON')
  }
  const v = parsed as { pass?: unknown; reasoning?: unknown; rubric?: unknown }
  if (typeof v.pass !== 'boolean') throw new Error('judge JSON missing boolean "pass"')
  if (typeof v.reasoning !== 'string' || v.reasoning.trim().length < 10) throw new Error('judge JSON missing written "reasoning"')
  if (!Array.isArray(v.rubric) || v.rubric.length === 0) throw new Error('judge JSON missing "rubric"')
  const rubric: RubricItem[] = v.rubric.map((r) => {
    const item = r as { criterion?: unknown; score?: unknown; max?: unknown; comment?: unknown }
    if (typeof item.criterion !== 'string' || typeof item.score !== 'number') throw new Error('judge rubric item malformed')
    const max = typeof item.max === 'number' && item.max > 0 ? item.max : 10
    return {
      criterion: item.criterion,
      score: Math.max(0, Math.min(max, item.score)),
      max,
      comment: typeof item.comment === 'string' ? item.comment : '',
    }
  })
  return { pass: v.pass, reasoning: v.reasoning.trim(), rubric }
}
