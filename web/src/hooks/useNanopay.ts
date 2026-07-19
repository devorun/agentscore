import { useQuery } from '@tanstack/react-query'
import { apiNanopay, type ApiNanopay } from '@/lib/api'
import { API_URL } from '@/lib/config'

/** Circle Nanopayments per-row ledger for a job (backend-backed). Returns null
 * when there is no backend or the job was not metered on the nanopayments rail. */
export function useNanopay(jobId: bigint | undefined) {
  return useQuery<ApiNanopay | null>({
    queryKey: ['nanopay', jobId?.toString()],
    queryFn: async () => {
      try {
        return await apiNanopay(jobId!.toString())
      } catch {
        return null // no backend, or this job was not metered on the rail
      }
    },
    enabled: API_URL !== undefined && jobId !== undefined,
    refetchInterval: 5000,
  })
}
