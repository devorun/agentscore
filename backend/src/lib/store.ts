import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { EnrichedRow, VerifyChecks } from './enrichment.js'
import type { RubricItem } from './judged.js'

// Deliverable store on disk so the real work product is retrievable (by the
// arbiter for verification, and by the job page so a judge can see it).
const DIR = fileURLToPath(new URL('../../data/deliverables/', import.meta.url))

export interface Verdict {
  outcome: 'approved' | 'rejected'
  // Deterministic (re-derived) verdicts:
  checks?: VerifyChecks
  expectedRowCount?: number
  gotRowCount?: number
  // Judged-quality verdicts (independent LLM evaluation):
  rubric?: RubricItem[]
  reasoning?: string
  reasonHash?: string
  arbiterModel?: string
  deliverableHashMatch?: boolean
  verifiedAt: number
  settleTx?: string
}

/** A second-arbiter appeal outcome, recorded onchain in AgentScoreAppeals and
 * mirrored here for the job page (reasoning + rubric). `overturned` = result
 * differs from the original verdict. */
export interface AppealRecord {
  filedBy: string // the losing party who contested (agent for a rejection, client for an approval)
  appealArbiter: string
  appealModel: string
  original: 'approved' | 'rejected'
  result: 'approved' | 'rejected'
  overturned: boolean
  rubric?: RubricItem[]
  reasoning: string
  reasonHash: string
  attestTx?: string
  resolvedAt: number
}

export interface DeliverableRecord {
  jobId: string
  /** Absent = 'deterministic' (records written before judged jobs existed). */
  kind?: 'deterministic' | 'judged'
  producedBy: string
  spec: string
  inputRows: number
  output: EnrichedRow[]
  /** Judged jobs: the agent's actual written memo (hashes to outputHash). */
  memo?: string
  agentModel?: string
  outputHash: string
  submittedTx?: string
  verdict?: Verdict
  /** Second-arbiter appeal of the verdict, if one was filed. */
  appeal?: AppealRecord
  createdAt: number
}

const pathFor = (jobId: string) => `${DIR}${jobId}.json`

export function saveDeliverable(rec: DeliverableRecord): void {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(pathFor(rec.jobId), JSON.stringify(rec, null, 2))
}

export function getDeliverable(jobId: string): DeliverableRecord | null {
  const p = pathFor(jobId)
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8')) as DeliverableRecord
}

export function setVerdict(jobId: string, verdict: Verdict): void {
  const rec = getDeliverable(jobId)
  if (!rec) return
  rec.verdict = verdict
  saveDeliverable(rec)
}

export function setAppeal(jobId: string, appeal: AppealRecord): void {
  const rec = getDeliverable(jobId)
  if (!rec) return
  rec.appeal = appeal
  saveDeliverable(rec)
}

// --- Circle Nanopayments ledger ---------------------------------------------
// Per-job record of the per-row micro-USDC rail: each row is a gasless, off-chain
// (batched) Gateway settlement identified by a settlement id — NOT a tx hash. The
// on-chain footprint is the one-time deposit and the agent's withdraw-mint.
const NANO_DIR = fileURLToPath(new URL('../../data/nanopay/', import.meta.url))

export interface NanopayRow {
  index: number
  amountUsdc: string
  settleId: string // Gateway settlement id (off-chain, batched) — not a tx hash
  network: string
  at: number
}

export interface NanopayLedger {
  jobId: string
  pricePerRowUsdc: string
  buyer: string
  seller: string
  network: string
  depositTx?: string // on-chain: funds the buyer's Gateway balance
  rows: NanopayRow[]
  totalPaidUsdc: string
  withdrawMintTx?: string // on-chain: agent realizes accrued earnings (mint)
  withdrawAmountUsdc?: string
  createdAt: number
  updatedAt: number
}

const nanoPathFor = (jobId: string) => `${NANO_DIR}${jobId}.json`

export function saveNanopay(led: NanopayLedger): void {
  mkdirSync(NANO_DIR, { recursive: true })
  writeFileSync(nanoPathFor(led.jobId), JSON.stringify(led, null, 2))
}

export function getNanopay(jobId: string): NanopayLedger | null {
  const p = nanoPathFor(jobId)
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8')) as NanopayLedger
}
