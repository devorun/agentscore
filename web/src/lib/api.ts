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

export const apiAgent = (address: string) => apiGet<ApiAgent>(`/agent/${address}`)
export const apiJobs = () => apiGet<{ jobs: ApiJob[] }>('/jobs')

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
