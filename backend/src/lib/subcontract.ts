// Agent-to-agent subcontracting (Item 3): an agent that takes a job delegates
// PART of it to a specialist agent and pays that agent from its own balance. The
// sub-job is a NATIVE ERC-8183 job — the prime agent is its client, the
// specialist its provider — linked to the main job by an onchain description
// marker. No new contract; Circle's reference contract custodies both escrows and
// ours still hold no funds. The marker is one-directional (sub -> main), since
// the sub-job is created after (and references) the main job.

/** Marker embedded in the SUB-job's onchain description → links it to its main job. */
export function subcontractMarker(mainJobId: bigint | string): string {
  return `[SUBCONTRACT main=#${mainJobId}]`
}

/** The main job id a sub-job references, or null if the description is not a subcontract. */
export function parseSubcontract(description: string): bigint | null {
  const m = description.match(/\[SUBCONTRACT\s+main=#?(\d+)\]/i)
  return m ? BigInt(m[1]) : null
}

export function isSubcontractJob(description: string): boolean {
  return /\[SUBCONTRACT\s+main=#?\d+\]/i.test(description)
}

/** The spec with the marker stripped (what the specialist is actually asked to do). */
export function subcontractSpec(description: string): string {
  return description.replace(/\[SUBCONTRACT\s+main=#?\d+\]/i, '').replace(/\s+/g, ' ').trim()
}
