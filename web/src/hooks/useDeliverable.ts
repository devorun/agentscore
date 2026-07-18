import { useQuery } from '@tanstack/react-query'
import { apiDeliverable, type ApiDeliverable } from '@/lib/api'
import { API_URL } from '@/lib/config'

/** The real work product + arbiter verification for a job (backend-backed). */
export function useDeliverable(jobId: bigint | undefined) {
  return useQuery<ApiDeliverable | null>({
    queryKey: ['deliverable', jobId?.toString()],
    queryFn: async () => {
      try {
        return await apiDeliverable(jobId!.toString())
      } catch {
        return null // no backend, or no deliverable for this job
      }
    },
    enabled: API_URL !== undefined && jobId !== undefined,
    refetchInterval: 5000,
  })
}
