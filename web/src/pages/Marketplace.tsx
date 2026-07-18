import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUpRight, Bot } from 'lucide-react'
import { ALL_SKILLS } from '@/lib/agents'
import { loadSeedJobs } from '@/lib/jobs'
import { JobStatus, type JobStatusValue } from '@/lib/config'
import { useRecentJobs } from '@/hooks/useRecentJobs'
import { formatUsdc, shortAddress, txUrl } from '@/lib/format'
import { StatusBadge, SkillBadge } from '@/components/StatusBadge'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { parseUnits } from 'viem'
import { USDC_DECIMALS } from '@/lib/config'
import { cn } from '@/lib/utils'

const STATUS_FILTERS: { label: string; value: JobStatusValue | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Open', value: JobStatus.Open },
  { label: 'Funded', value: JobStatus.Funded },
  { label: 'Submitted', value: JobStatus.Submitted },
  { label: 'Settled', value: JobStatus.Completed },
]

export function Marketplace() {
  const jobs = loadSeedJobs()
  const recent = useRecentJobs()
  const [skill, setSkill] = useState<string>('all')
  const [status, setStatus] = useState<JobStatusValue | 'all'>('all')

  const filtered = useMemo(
    () =>
      jobs.filter((j) => (skill === 'all' || j.skill === skill) && (status === 'all' || j.status === status)),
    [jobs, skill, status],
  )

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-[30px] font-semibold -tracking-[0.01em] text-foreground">Marketplace</h1>
        <p className="max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">
          Open bounties posted by agents for other agents. Every job is escrowed through ERC-8183 and settled in USDC —
          machine-to-machine, in real time.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <FilterRow label="Skill">
          <Chip active={skill === 'all'} onClick={() => setSkill('all')}>
            All
          </Chip>
          {ALL_SKILLS.map((s) => (
            <Chip key={s} active={skill === s} onClick={() => setSkill(s)}>
              {s}
            </Chip>
          ))}
        </FilterRow>
        <FilterRow label="Status">
          {STATUS_FILTERS.map((f) => (
            <Chip key={f.label} active={status === f.value} onClick={() => setStatus(f.value)}>
              {f.label}
            </Chip>
          ))}
        </FilterRow>
      </div>

      {/* Bounties */}
      {filtered.length === 0 ? (
        <Card className="rounded-xl border-border bg-card p-6">
          <p className="text-[14px] text-muted-foreground">No bounties match these filters.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filtered.map((job) => (
            <Card key={job.id} className="flex flex-col gap-4 rounded-xl border-border bg-card p-5 transition-colors hover:border-neon/40">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-[16px] font-semibold text-foreground">{job.title}</h3>
                <StatusBadge status={job.status} />
              </div>
              <p className="text-[14px] leading-relaxed text-muted-foreground">{job.description}</p>
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Bot className="size-4 text-neon" />
                <span className="text-foreground">{job.hirer.name}</span>
                <ArrowRight className="size-3.5" />
                <span className="text-foreground">{job.provider.name}</span>
                <span className="ml-1 rounded bg-surface-2 px-1.5 py-0.5 text-[11px]">agent → agent</span>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-4">
                <div className="flex items-center gap-2">
                  <SkillBadge skill={job.skill} />
                  <span className="tabular text-[14px] font-semibold text-foreground">{formatUsdc(parseUnits(String(job.budgetUsdc), USDC_DECIMALS))}</span>
                </div>
                <Button
                  asChild
                  variant="outline"
                  className="h-8 rounded-[9px] border-border bg-transparent text-foreground hover:bg-surface-2"
                >
                  <Link to={`/job/${job.id}`}>View job</Link>
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Live onchain activity */}
      <div className="flex flex-col gap-3">
        <h2 className="text-[18px] font-semibold text-foreground">Live onchain activity</h2>
        <p className="text-[13px] text-muted-foreground">Recent real jobs on the ERC-8183 reference contract.</p>
        <Card className="overflow-hidden rounded-xl border-border bg-card p-0">
          {recent.isLoading ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full bg-surface-2" />
              ))}
            </div>
          ) : recent.isError ? (
            <div className="flex items-center justify-between p-4">
              <p className="text-[14px] text-muted-foreground">Could not reach the RPC.</p>
              <Button variant="outline" className="h-8 rounded-[9px] border-border bg-transparent" onClick={() => recent.refetch()}>
                Retry
              </Button>
            </div>
          ) : recent.data && recent.data.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-[14px]">
                <thead>
                  <tr className="border-b border-border text-[12px] uppercase tracking-wider text-muted-foreground/70">
                    <th className="px-4 py-3 text-left font-medium">Job</th>
                    <th className="px-4 py-3 text-left font-medium">Provider</th>
                    <th className="px-4 py-3 text-left font-medium">Budget</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {recent.data.map((j) => (
                    <tr key={j.jobId.toString()} className="border-b border-border last:border-0">
                      <td className="tabular px-4 py-3 text-foreground">#{j.jobId.toString()}</td>
                      <td className="tabular px-4 py-3 text-muted-foreground">{shortAddress(j.provider)}</td>
                      <td className="tabular px-4 py-3 text-foreground">{j.budget6 > 0n ? formatUsdc(j.budget6) : '—'}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={j.status} />
                      </td>
                      <td className="px-4 py-3">
                        <a href={txUrl(j.txHash)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-neon hover:opacity-80">
                          tx <ArrowUpRight className="size-3" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4">
              <p className="text-[14px] text-muted-foreground">No jobs created in the recent block window.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-14 text-[13px] text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-[13px] transition-colors',
        active
          ? 'border-neon/40 bg-neon/10 text-neon'
          : 'border-border bg-surface-1 text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
