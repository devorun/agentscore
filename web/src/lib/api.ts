import { API_URL } from './config'

// Thin client for the AgentScore backend. Every call throws on failure or when
// no API is configured, so callers can cleanly fall back to direct chain reads.

async function apiGet<T>(path: string, timeoutMs = 4000): Promise<T> {
  if (!API_URL) throw new Error('API not configured')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${API_URL}${path}`, { signal: controller.signal })
    if (!res.ok) throw new Error(`API ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export interface ApiAgent {
  address: `0x${string}`
  score: number
  breakdown: { score: number; base: number; approvalPoints: number; rejectionPoints: number; abandonmentPoints: number; volumeBonus: number }
  completionRate: number | null
  metrics: { totalJobs: number; completed: number; rejected: number; expired: number; lifetimeEarningsUsdc: string; settledValueUsdc: string }
  jobs: {
    jobId: string
    status: string
    budgetUsdc: string
    client: `0x${string}`
    evaluator: `0x${string}`
    description: string
    createdAt: number
    tx: string
  }[]
  truncated: boolean
}

export interface ApiJob {
  jobId: string
  status: string
  budgetUsdc: string
  client: `0x${string}`
  provider: `0x${string}`
  description: string
  tx: string
}

export interface ApiRubricItem {
  criterion: string
  score: number
  max: number
  comment: string
}

export interface ApiDeliverable {
  jobId: string
  kind: 'deterministic' | 'judged'
  producedBy: `0x${string}`
  spec: string
  inputRows: number
  outputRows: number
  outputHash: string
  memo: string | null
  agentModel: string | null
  submittedTx: string | null
  verdict: {
    outcome: 'approved' | 'rejected'
    // Deterministic (re-derived) verdicts:
    checks?: { schema: boolean; rowCount: boolean; noDuplicates: boolean; checksumMatch: boolean; exactMatch: boolean }
    expectedRowCount?: number
    gotRowCount?: number
    // Judged-quality verdicts (independent LLM evaluation):
    rubric?: ApiRubricItem[]
    reasoning?: string
    reasonHash?: string
    arbiterModel?: string
    deliverableHashMatch?: boolean
    settleTx: string | null
  } | null
  output: { address: string; balanceUsd: number; txCount: number; risk: 'low' | 'medium' | 'high' }[]
}

export interface ApiNanopayRow {
  index: number
  amountUsdc: string
  settleId: string // Gateway settlement id (off-chain, batched) — not a tx hash
  network: string
  at: number
}

export interface ApiNanopay {
  jobId: string
  pricePerRowUsdc: string
  buyer: `0x${string}`
  seller: `0x${string}`
  network: string
  onchain: { deposit: string | null; withdrawMint: string | null; withdrawAmountUsdc: string | null }
  offchain: { note: string; rowCount: number; totalPaidUsdc: string; rows: ApiNanopayRow[] }
  updatedAt: number
}

export const apiAgent = (address: string) => apiGet<ApiAgent>(`/agent/${address}`)
export const apiJobs = () => apiGet<{ jobs: ApiJob[] }>('/jobs')
export const apiDeliverable = (jobId: string) => apiGet<ApiDeliverable>(`/deliverable/${jobId}`)
export const apiNanopay = (jobId: string) => apiGet<ApiNanopay>(`/nanopayments/${jobId}`)

export const STATUS_INDEX: Record<string, number> = {
  open: 0,
  funded: 1,
  submitted: 2,
  completed: 3,
  rejected: 4,
  expired: 5,
}

/** The API returns a full Arcscan URL; the UI wants the bare tx hash. */
export function txHashFromUrl(url: string): string {
  return url.split('/').pop() ?? url
}
