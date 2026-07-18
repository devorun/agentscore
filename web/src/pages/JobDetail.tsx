import { Link, useParams } from 'react-router-dom'
import { useReadContract } from 'wagmi'
import { ArrowRight, ArrowUpRight, Check } from 'lucide-react'
import { findSeedJob, type SeedJob } from '@/lib/jobs'
import { erc8183Abi } from '@/lib/abi'
import { ARBITER_ADDRESS, ERC8183_ADDRESS, JobStatus, type JobStatusValue } from '@/lib/config'
import { addressUrl, formatUsdc, shortAddress, txUrl } from '@/lib/format'
import { useJobEvents, type JobEvent } from '@/hooks/useJobEvents'
import { AgentMindTerminal, type TermLine } from '@/components/AgentMindTerminal'
import { StatusBadge, SkillBadge } from '@/components/StatusBadge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { parseUnits, type Address } from 'viem'
import { USDC_DECIMALS } from '@/lib/config'
import { cn } from '@/lib/utils'

const TIMELINE: { label: string; value: JobStatusValue }[] = [
  { label: 'Open', value: JobStatus.Open },
  { label: 'Funded', value: JobStatus.Funded },
  { label: 'Submitted', value: JobStatus.Submitted },
  { label: 'Settled', value: JobStatus.Completed },
]

export function JobDetail() {
  const { id } = useParams()
  const seed = id ? findSeedJob(id) : undefined
  const numericId = id && /^\d+$/.test(id) ? BigInt(id) : undefined

  if (seed) return <SeedJobDetail job={seed} />
  if (numericId !== undefined) return <RealJobDetail jobId={numericId} />

  return (
    <div className="flex flex-col items-start gap-4 py-6">
      <h1 className="text-[26px] font-semibold text-foreground">Job not found</h1>
      <Link to="/marketplace" className="text-[14px] text-neon hover:opacity-80">
        ← Back to the marketplace
      </Link>
    </div>
  )
}

function ExplorerLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-neon hover:opacity-80">
      {children}
      <ArrowUpRight className="size-3" />
    </a>
  )
}

function Timeline({ status }: { status: JobStatusValue }) {
  const reachedIndex = TIMELINE.findIndex((t) => t.value === status)
  const rejected = status === JobStatus.Rejected
  const expired = status === JobStatus.Expired
  return (
    <div className="flex flex-col gap-3">
      {TIMELINE.map((t, i) => {
        const done = reachedIndex >= 0 && i <= reachedIndex
        const active = i === reachedIndex
        return (
          <div key={t.label} className="flex items-center gap-3">
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full border text-[12px] tabular',
                done ? 'border-success/40 bg-success/15 text-success' : 'border-border text-muted-foreground',
              )}
            >
              {done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={cn('text-[14px]', active || done ? 'text-foreground' : 'text-muted-foreground')}>{t.label}</span>
          </div>
        )
      })}
      {rejected ? <p className="text-[13px] text-danger">Rejected by the arbiter — escrow refunded to the client.</p> : null}
      {expired ? <p className="text-[13px] text-muted-foreground">Expired before submission — escrow refundable.</p> : null}
    </div>
  )
}

function buildScript(job: SeedJob): TermLine[] {
  const B = `${job.budgetUsdc.toFixed(2)} USDC`
  const full: TermLine[] = [
    { text: `> job ${job.id} created by ${job.hirer.name}.agent`, tone: 'accent' },
    { text: `  "${job.title}"`, tone: 'muted' },
    { text: `> ${job.provider.name}.agent accepted · setBudget ${B}` },
    { text: `> ${job.hirer.name}.agent approved ${B} (exact) · fund escrow` },
    { text: `  escrow locked in ERC-8183 reference contract`, tone: 'muted' },
    { text: `> ${job.provider.name}.agent: analyzing task…` },
    { text: `> ${job.provider.name}.agent: generating deliverable hash 0x9f2a…c17b` },
    { text: `> ${job.provider.name}.agent: submit(${job.id}, 0x9f2a…c17b) onchain` },
    { text: `> AGENTSCORE.ARBITER: verifying deliverable…`, tone: 'accent' },
    { text: `  checks: format ✓  submitted-before-deadline ✓`, tone: 'muted' },
    { text: `> AGENTSCORE.ARBITER: verdict APPROVED`, tone: 'success' },
    { text: `> AGENTSCORE.ARBITER: complete(${job.id}) · release ${B} → ${job.provider.name}.agent`, tone: 'success' },
    { text: `> settlement confirmed · ${job.provider.name} reputation updated`, tone: 'success' },
    { text: `> loop complete · 0 human clicks`, tone: 'success' },
  ]
  const cut: Partial<Record<JobStatusValue, number>> = {
    [JobStatus.Open]: 2,
    [JobStatus.Funded]: 5,
    [JobStatus.Submitted]: 8,
    [JobStatus.Completed]: full.length,
  }
  const lines = full.slice(0, cut[job.status] ?? full.length)
  if (job.status === JobStatus.Open) lines.push({ text: `> awaiting a provider to accept…`, tone: 'warning' })
  else if (job.status === JobStatus.Funded) lines.push({ text: `> ${job.provider.name}.agent working…`, tone: 'warning' })
  else if (job.status === JobStatus.Submitted) lines.push({ text: `> awaiting arbiter verdict…`, tone: 'warning' })
  return lines
}

// Real onchain events (from the reference contract + our registry) → terminal
// lines, each linking to its Arcscan transaction. Used for live jobs.
function buildLiveLines(events: JobEvent[], status: JobStatusValue, budget: bigint): TermLine[] {
  const lines: TermLine[] = []
  for (const e of events) {
    const href = txUrl(e.txHash)
    switch (e.name) {
      case 'JobCreated':
        lines.push({
          text: `> job #${e.args.jobId} created · ${shortAddress(e.args.client)} → ${shortAddress(e.args.provider)}`,
          tone: 'accent',
          href,
        })
        break
      case 'BudgetSet':
        lines.push({ text: `> agent set price ${formatUsdc(e.args.amount)}`, href })
        break
      case 'JobFunded':
        lines.push({ text: `> client funded escrow ${formatUsdc(e.args.amount)}`, href })
        break
      case 'JobSubmitted':
        lines.push({ text: `> agent submitted deliverable ${String(e.args.deliverable).slice(0, 12)}…`, href })
        break
      case 'JobCompleted':
        lines.push({ text: `> AGENTSCORE.ARBITER: verdict complete`, tone: 'accent', href })
        break
      case 'PaymentReleased':
        lines.push({ text: `> released ${formatUsdc(e.args.amount)} → agent`, tone: 'success', href })
        break
      case 'JobRejected':
        lines.push({ text: `> AGENTSCORE.ARBITER: verdict reject`, tone: 'danger', href })
        break
      case 'Refunded':
        lines.push({ text: `> escrow refunded ${formatUsdc(e.args.amount)} → client`, tone: 'warning', href })
        break
      case 'VerdictAttested':
        lines.push({
          text: `> verdict attested to registry (${Number(e.args.outcome) === 0 ? 'APPROVED' : 'REJECTED'})`,
          tone: 'success',
          href,
        })
        break
    }
  }
  if (status === JobStatus.Open && budget === 0n) lines.push({ text: `> awaiting the agent to set the price…`, tone: 'warning' })
  else if (status === JobStatus.Open) lines.push({ text: `> awaiting the client to fund escrow…`, tone: 'warning' })
  else if (status === JobStatus.Funded) lines.push({ text: `> agent is working — submitting shortly…`, tone: 'warning' })
  else if (status === JobStatus.Submitted) lines.push({ text: `> arbiter verifying deliverable…`, tone: 'warning' })
  else if (status === JobStatus.Completed)
    lines.push({ text: `> loop complete · settled onchain · 0 human clicks after funding`, tone: 'success' })
  if (lines.length === 0) lines.push({ text: `> streaming onchain events…`, tone: 'muted' })
  return lines
}

function SeedJobDetail({ job }: { job: SeedJob }) {
  const budget6 = parseUnits(String(job.budgetUsdc), USDC_DECIMALS)
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-[12px] uppercase tracking-wider text-muted-foreground/70">
          Job {job.id}
          <SkillBadge skill={job.skill} />
        </div>
        <div className="flex items-center gap-3">
          <h1 className="text-[26px] font-semibold -tracking-[0.01em] text-foreground">{job.title}</h1>
          <StatusBadge status={job.status} />
        </div>
        <p className="max-w-[70ch] text-[15px] leading-relaxed text-muted-foreground">{job.description}</p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col gap-5">
          <Card className="flex flex-col gap-4 rounded-xl border-border bg-card p-5">
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Participants</h2>
            <div className="flex items-center gap-2 text-[14px]">
              <span className="text-foreground">{job.hirer.name}</span>
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted-foreground">hirer · agent</span>
              <ArrowRight className="size-4 text-neon" />
              <span className="text-foreground">{job.provider.name}</span>
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted-foreground">provider</span>
            </div>
            <Row label="Hirer" value={<ExplorerLink href={addressUrl(job.hirer.address)}>{shortAddress(job.hirer.address)}</ExplorerLink>} />
            <Row label="Provider" value={<ExplorerLink href={addressUrl(job.provider.address)}>{shortAddress(job.provider.address)}</ExplorerLink>} />
            <Row label="Evaluator (arbiter)" value={<ExplorerLink href={addressUrl(ARBITER_ADDRESS)}>{shortAddress(ARBITER_ADDRESS)}</ExplorerLink>} />
            <Row label="Escrow" value={<span className="tabular font-semibold text-foreground">{formatUsdc(budget6)}</span>} />
            <Row label="Settlement" value={<span className="text-foreground">Real-time USDC</span>} />
          </Card>

          <Card className="flex flex-col gap-4 rounded-xl border-border bg-card p-5">
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">State timeline</h2>
            <Timeline status={job.status} />
          </Card>
        </div>

        <div className="flex flex-col gap-2">
          <AgentMindTerminal lines={buildScript(job)} simulation />
          <p className="text-[12px] text-muted-foreground">
            Simulated replay of the autonomous loop. When the arbiter agent runs against a funded job, these are its real
            steps — Agent A hires Agent B, B delivers, the arbiter verifies and releases USDC, and B’s reputation updates
            with zero human clicks.
          </p>
        </div>
      </div>
    </div>
  )
}

function RealJobDetail({ jobId }: { jobId: bigint }) {
  const { data, isLoading, isError } = useReadContract({
    address: ERC8183_ADDRESS,
    abi: erc8183Abi,
    functionName: 'getJob',
    args: [jobId],
    query: { refetchInterval: 5000 },
  })
  const events = useJobEvents(jobId, true)

  if (isLoading) return <Skeleton className="h-64 w-full rounded-xl bg-surface-1" />
  if (isError || !data)
    return (
      <Card className="rounded-xl border-destructive/40 bg-card p-6">
        <p className="text-[14px] text-muted-foreground">Could not read job #{jobId.toString()} from the reference contract.</p>
      </Card>
    )

  const job = data as {
    client: Address
    provider: Address
    evaluator: Address
    description: string
    budget: bigint
    status: number
  }
  const lines = buildLiveLines(events.data ?? [], job.status as JobStatusValue, job.budget)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="tabular text-[26px] font-semibold text-foreground">Job #{jobId.toString()}</h1>
        <StatusBadge status={job.status as JobStatusValue} />
      </div>
      <p className="max-w-[70ch] text-[15px] text-muted-foreground">{job.description || 'No description onchain.'}</p>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col gap-5">
          <Card className="flex flex-col gap-4 rounded-xl border-border bg-card p-5">
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Participants</h2>
            <Row label="Client" value={<ExplorerLink href={addressUrl(job.client)}>{shortAddress(job.client)}</ExplorerLink>} />
            <Row label="Provider" value={<ExplorerLink href={addressUrl(job.provider)}>{shortAddress(job.provider)}</ExplorerLink>} />
            <Row label="Evaluator" value={<ExplorerLink href={addressUrl(job.evaluator)}>{shortAddress(job.evaluator)}</ExplorerLink>} />
            <Row label="Escrow" value={<span className="tabular font-semibold text-foreground">{formatUsdc(job.budget)}</span>} />
          </Card>
          <Card className="flex flex-col gap-4 rounded-xl border-border bg-card p-5">
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">State timeline</h2>
            <Timeline status={job.status as JobStatusValue} />
          </Card>
        </div>
        <div className="flex flex-col gap-2">
          <AgentMindTerminal lines={lines} simulation={false} animate={false} />
          <p className="text-[12px] text-muted-foreground">
            Live — streamed from this job’s real onchain events. Each step links to its Arcscan transaction.
          </p>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-[14px]">
      <span className="text-muted-foreground">{label}</span>
      {value}
    </div>
  )
}
