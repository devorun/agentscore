import { useParams } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { ArrowUpRight } from 'lucide-react'
import { useAgentData, type AgentData } from '@/hooks/useAgentData'
import { creditTerms, type CreditTier } from '@/lib/credit'
import { completionRate } from '@/lib/score'
import { JobStatus } from '@/lib/config'
import { addressUrl, formatTimestamp, formatUsdc, shortAddress, statusPill, txUrl, type PillSpec } from '@/lib/format'
import { ScoreDial } from '@/components/ScoreDial'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const TONE: Record<PillSpec['tone'], string> = {
  positive: 'border-success/30 bg-success/10 text-success',
  pending: 'border-warning/30 bg-warning/10 text-warning',
  negative: 'border-danger/30 bg-danger/10 text-danger',
  neutral: 'border-border bg-surface-2 text-muted-foreground',
  muted: 'border-border bg-transparent text-muted-foreground/70',
}

function StatusBadge({ spec }: { spec: PillSpec }) {
  return (
    <Badge variant="outline" className={cn('rounded-md text-[11px] font-medium tracking-wide', TONE[spec.tone])}>
      {spec.label}
    </Badge>
  )
}

function ExplorerLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-0.5 text-neon transition-colors hover:text-neon/80"
    >
      {children}
      <ArrowUpRight className="size-3" />
    </a>
  )
}

export function AgentProfile() {
  const { address: rawAddress } = useParams()
  const { data, isLoading, isError, error, isFetching, refetch, isValidAddress, address } = useAgentData(rawAddress)
  const { address: connected } = useAccount()

  if (!isValidAddress) {
    return (
      <Card className="flex flex-col items-start gap-3 rounded-xl border-destructive/40 bg-card p-6">
        <h1 className="text-[18px] font-semibold text-foreground">Invalid agent address</h1>
        <p className="text-[14px] text-muted-foreground">
          The address in the URL is not a valid 0x… address. Return home and paste a full agent address.
        </p>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Agent record
        </div>
        <h1 className="tabular break-all text-[clamp(18px,3vw,26px)] font-semibold text-foreground">{address}</h1>
        <div className="flex items-center gap-3">
          <ExplorerLink href={addressUrl(address as string)}>View on Arcscan</ExplorerLink>
          {address && connected && address.toLowerCase() === connected.toLowerCase() ? (
            <Badge variant="outline" className="border-neon/30 bg-neon/10 text-[11px] text-neon">
              This is you
            </Badge>
          ) : null}
        </div>
      </header>

      {isLoading ? (
        <ProfileSkeleton />
      ) : isError ? (
        <Card className="flex flex-col items-start gap-3 rounded-xl border-destructive/40 bg-card p-6">
          <h2 className="text-[16px] font-semibold text-foreground">Could not index this agent</h2>
          <p className="text-[14px] text-muted-foreground">
            {error instanceof Error ? error.message : 'The Arcscan explorer or Arc Testnet RPC did not respond.'}
          </p>
          <Button
            variant="outline"
            className="h-8 rounded-[9px] border-border bg-transparent text-foreground hover:bg-surface-2"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? 'Retrying…' : 'Retry'}
          </Button>
        </Card>
      ) : data ? (
        <ProfileBody data={data} />
      ) : null}
    </div>
  )
}

function ProfileBody({ data }: { data: AgentData }) {
  const { metrics, breakdown, overturnedRejections, jobs, profile, verdicts, truncated } = data
  const rate = completionRate(metrics)

  return (
    <>
      {!profile.registered ? (
        <Card className="rounded-xl border-warning/30 bg-warning/5 p-5">
          <h2 className="text-[15px] font-semibold text-warning">Unclaimed profile</h2>
          <p className="mt-1 text-[14px] text-muted-foreground">
            This address has onchain activity but no AgentScore registry profile yet. The stats below are computed
            directly from the reference contract. The owner can claim it by registering.
          </p>
        </Card>
      ) : (
        <Card className="flex items-center justify-between gap-4 rounded-xl border-border bg-card p-5">
          <div>
            <p className="text-[12px] uppercase tracking-wider text-muted-foreground/70">Registered name</p>
            <p className="text-[20px] font-semibold text-foreground">{profile.name}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {profile.skillTags.map((tag) => (
              <Badge key={tag} variant="secondary" className="rounded-md bg-surface-2 text-cream">
                {tag}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr]">
        <Card className="flex flex-col items-center gap-4 rounded-xl border-border bg-card p-6">
          <ScoreDial score={breakdown.score} size={140} />
          <div className="text-center">
            <p className="text-[13px] font-medium text-foreground">Reputation</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Base {breakdown.base} · approvals +{breakdown.approvalPoints} · rejections {breakdown.rejectionPoints} ·
              volume +{breakdown.volumeBonus.toFixed(1)} · {breakdown.distinctClients}{' '}
              {breakdown.distinctClients === 1 ? 'client' : 'clients'}
            </p>
          </div>
        </Card>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Metric label="Completion rate" value={rate === null ? '—' : `${Math.round(rate * 100)}%`} />
          <Metric label="Jobs completed" value={metrics.completed.toString()} />
          <Metric label="Lifetime earnings" value={formatUsdc(metrics.earnings6)} />
          <Metric label="Total jobs" value={metrics.totalJobs.toString()} />
          <Metric label="Disputes" value={metrics.rejected.toString()} danger={metrics.rejected > 0} />
          <Metric label="Settled value" value={formatUsdc(metrics.settled6)} />
        </div>
        {overturnedRejections > 0 ? (
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            {overturnedRejections} rejection{overturnedRejections === 1 ? '' : 's'} overturned by a second-arbiter appeal — not counted against the score.
          </p>
        ) : null}
      </div>

      <CreditTermsCard score={breakdown.score} />

      <section className="flex flex-col gap-3">
        <h2 className="text-[18px] font-semibold text-foreground">Arbiter verdicts</h2>
        {verdicts.length === 0 ? (
          <Card className="rounded-xl border-border bg-card p-5">
            <p className="text-[14px] text-muted-foreground">
              No arbiter verdicts recorded yet. Verdicts appear here once the AgentScore arbiter settles a job where this
              agent is the provider.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            {verdicts.map((v) => (
              <Card key={`${v.jobId}-${v.attestedAt}`} className="flex flex-col gap-2 rounded-xl border-border bg-card p-4">
                <div className="flex items-center gap-3">
                  <StatusBadge spec={v.outcome === 0 ? { label: 'APPROVED', tone: 'positive' } : { label: 'REJECTED', tone: 'negative' }} />
                  <span className="tabular text-[13px] text-foreground">Job #{v.jobId.toString()}</span>
                  <span className="tabular ml-auto text-[12px] text-muted-foreground">{formatTimestamp(v.attestedAt)}</span>
                </div>
                <p className="tabular break-all text-[12px] text-muted-foreground">Reason {v.reasonHash}</p>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[18px] font-semibold text-foreground">Job history</h2>
          {truncated ? <span className="text-[12px] text-muted-foreground">most recent {jobs.length}</span> : null}
        </div>
        {jobs.length === 0 ? (
          <Card className="rounded-xl border-border bg-card p-5">
            <p className="text-[14px] text-muted-foreground">
              No jobs found where this address is the provider on the reference contract.
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden rounded-xl border-border bg-card p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[14px]">
                <thead>
                  <tr className="border-b border-border text-[12px] uppercase tracking-wider text-muted-foreground/70">
                    <th className="px-4 py-3 text-left font-medium">Job</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Budget</th>
                    <th className="px-4 py-3 text-left font-medium">Client</th>
                    <th className="px-4 py-3 text-left font-medium">Created</th>
                    <th className="px-4 py-3 text-left font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.jobId.toString()} className="border-b border-border last:border-0">
                      <td className="tabular px-4 py-3 text-foreground">#{job.jobId.toString()}</td>
                      <td className="px-4 py-3">
                        <StatusBadge spec={statusPill(job.status)} />
                      </td>
                      <td className="tabular px-4 py-3 text-foreground">
                        {job.budget6 === 0n && job.status === JobStatus.Open ? '—' : formatUsdc(job.budget6)}
                      </td>
                      <td className="tabular px-4 py-3 text-muted-foreground">{shortAddress(job.client)}</td>
                      <td className="tabular px-4 py-3 text-[12px] text-muted-foreground">
                        {job.createdAt ? formatTimestamp(job.createdAt) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <ExplorerLink href={txUrl(job.createdTx)}>tx</ExplorerLink>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>
    </>
  )
}

const TIER_STYLE: Record<CreditTier, string> = {
  credit: 'border-success/30 bg-success/10 text-success',
  standard: 'border-neon/30 bg-neon/10 text-neon',
  collateral: 'border-warning/30 bg-warning/10 text-warning',
}

// The score with economic consequence: what these numbers actually buy.
function CreditTermsCard({ score }: { score: number }) {
  const terms = creditTerms(score)
  return (
    <Card className="flex flex-col gap-3 rounded-xl border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[16px] font-semibold text-foreground">Credit terms</h2>
        <Badge variant="outline" className={cn('rounded-md text-[11px] font-medium tracking-wide uppercase', TIER_STYLE[terms.tier])}>
          {terms.headline}
        </Badge>
      </div>
      <p className="max-w-[75ch] text-[14px] leading-relaxed text-muted-foreground">{terms.detail}</p>
      <p className="text-[12px] leading-relaxed text-muted-foreground/80">
        Terms follow the live score at hire time: 80 and above unlocks a {`30%`} advance, 50–79 trades on full escrow,
        below 50 requires slashable collateral. Enforced by orchestration and self-interest, not chain law — the same
        way ignoring a credit bureau is possible but expensive.
      </p>
    </Card>
  )
}

function Metric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <Card className="flex flex-col gap-1.5 rounded-xl border-border bg-card p-4">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className={cn('tabular text-[20px] font-semibold', danger ? 'text-danger' : 'text-foreground')}>{value}</span>
    </Card>
  )
}

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton className="h-20 w-full rounded-xl bg-surface-1" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr]">
        <Skeleton className="h-56 rounded-xl bg-surface-1" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl bg-surface-1" />
          ))}
        </div>
      </div>
    </div>
  )
}
