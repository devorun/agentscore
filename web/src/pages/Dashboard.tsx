import { Link } from 'react-router-dom'
import { useAccount, useBalance, useConnect } from 'wagmi'
import { Wallet } from 'lucide-react'
import { useMyJobs, type MyJob } from '@/hooks/useMyJobs'
import { formatUsdc, shortAddress } from '@/lib/format'
import { StatusBadge } from '@/components/StatusBadge'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export function Dashboard() {
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { data: gas } = useBalance({ address })
  const jobs = useMyJobs(address)

  if (!isConnected || !address) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <Card className="flex flex-col items-start gap-4 rounded-xl border-border bg-card p-8">
          <p className="text-[15px] text-foreground">Connect your wallet to see the jobs you’ve opened and the funds in escrow.</p>
          <Button
            className="h-10 rounded-[9px] bg-primary font-medium text-primary-foreground hover:bg-[var(--primary-hover)]"
            onClick={() => connect({ connector: connectors[0] })}
          >
            <Wallet className="size-4" />
            Connect wallet
          </Button>
        </Card>
      </div>
    )
  }

  const asClient = jobs.data?.filter((j) => j.role === 'client') ?? []
  const asProvider = jobs.data?.filter((j) => j.role === 'provider') ?? []

  return (
    <div className="flex flex-col gap-6">
      <Header />
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <span className="rounded-full border border-border bg-surface-1 px-3 py-1.5 text-muted-foreground">
          Wallet <span className="tabular text-foreground">{shortAddress(address)}</span>
        </span>
        <span className="rounded-full border border-border bg-surface-1 px-3 py-1.5 text-muted-foreground">
          Gas <span className="tabular text-foreground">{gas ? `${Number(gas.formatted).toFixed(2)} USDC` : '—'}</span>
        </span>
      </div>

      {jobs.isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl bg-surface-1" />
          ))}
        </div>
      ) : jobs.isError ? (
        <Card className="flex items-center justify-between rounded-xl border-destructive/40 bg-card p-5">
          <p className="text-[14px] text-muted-foreground">Could not index your jobs from the reference contract.</p>
          <Button variant="outline" className="h-8 rounded-[9px] border-border bg-transparent" onClick={() => jobs.refetch()}>
            Retry
          </Button>
        </Card>
      ) : (
        <>
          <JobSection title="Jobs you opened (as client)" role="client" jobs={asClient} />
          <JobSection title="Jobs assigned to you (as provider)" role="provider" jobs={asProvider} />
        </>
      )}
    </div>
  )
}

function Header() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-[30px] font-semibold -tracking-[0.01em] text-foreground">My dashboard</h1>
      <p className="max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
        Jobs you’ve opened and funds in escrow, plus jobs where you’re the provider — read live from the ERC-8183
        reference contract.
      </p>
    </div>
  )
}

function JobSection({ title, jobs, role }: { title: string; jobs: MyJob[]; role: 'client' | 'provider' }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[16px] font-semibold text-foreground">{title}</h2>
      {jobs.length === 0 ? (
        <Card className="rounded-xl border-border bg-card p-5">
          <p className="text-[14px] text-muted-foreground">
            No jobs yet where you’re the {role}.{' '}
            {role === 'client' ? (
              <Link to="/" className="text-neon hover:opacity-80">
                Hire an agent
              </Link>
            ) : null}
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden rounded-xl border-border bg-card p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-[14px]">
              <thead>
                <tr className="border-b border-border text-[12px] uppercase tracking-wider text-muted-foreground/70">
                  <th className="px-4 py-3 text-left font-medium">Job</th>
                  <th className="px-4 py-3 text-left font-medium">{role === 'client' ? 'Provider' : 'Client'}</th>
                  <th className="px-4 py-3 text-left font-medium">Escrow</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.jobId.toString()} className="border-b border-border last:border-0">
                    <td className="tabular px-4 py-3 text-foreground">#{j.jobId.toString()}</td>
                    <td className="tabular px-4 py-3 text-muted-foreground">{shortAddress(j.counterparty)}</td>
                    <td className="tabular px-4 py-3 text-foreground">{j.budget6 > 0n ? formatUsdc(j.budget6) : '—'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={j.status} />
                    </td>
                    <td className="px-4 py-3">
                      <Link to={`/job/${j.jobId.toString()}`} className="text-neon hover:opacity-80">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </section>
  )
}
