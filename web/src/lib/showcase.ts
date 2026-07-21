import type { ApiDeliverable } from './api'
import records from './showcase-records.json'

// Bundled showcase records for the two completed judged-quality proof jobs
// (#158793 judged pass — the arbiter caught a real grounding flaw; #158794 lazy
// off-spec memo — rejected). The cloud settlement worker handles deterministic
// hires live; judged jobs run in the local demo path, so their full records
// (memo, rubric, written reasoning) ship with the app instead of an API.
//
// Authenticity is NOT taken on trust: these are real records whose hashes are
// committed onchain, and the job page recomputes keccak(reasoning) in the
// visitor's browser and matches it against the job's onchain verdict event —
// the chain vouches for the bundle, not us.
const SHOWCASE = records as unknown as Record<string, ApiDeliverable>

/** The bundled record for a job id, if this job is a showcase proof. */
export function showcaseDeliverable(jobId: string): ApiDeliverable | undefined {
  return SHOWCASE[jobId]
}

export const SHOWCASE_JOB_IDS = Object.keys(SHOWCASE)
