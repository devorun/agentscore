import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { EnrichedRow, VerifyChecks } from './enrichment.js'

// Deliverable store on disk so the real work product is retrievable (by the
// arbiter for verification, and by the job page so a judge can see it).
const DIR = fileURLToPath(new URL('../../data/deliverables/', import.meta.url))

export interface Verdict {
  outcome: 'approved' | 'rejected'
  checks: VerifyChecks
  expectedRowCount: number
  gotRowCount: number
  verifiedAt: number
  settleTx?: string
}

export interface DeliverableRecord {
  jobId: string
  producedBy: string
  spec: string
  inputRows: number
  output: EnrichedRow[]
  outputHash: string
  submittedTx?: string
  verdict?: Verdict
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
