import { Link, useParams } from 'react-router-dom'
import { useReadContract } from 'wagmi'
import { ArrowRight, ArrowUpRight, Check } from 'lucide-react'
import { findSeedJob, type SeedJob } from '@/lib/jobs'
import { erc8183Abi } from '@/lib/abi'
import { ARBITER_ADDRESS, ERC8183_ADDRESS, JobStatus, type JobStatusValue } from '@/lib/config'
import { addressUrl, formatUsdc, shortAddress, txUrl } from '@/lib/format'
import { useJobEvents, type JobEvent } from '@/hooks/useJobEvents'
import { useDeliverable } from '@/hooks/useDeliverable'
import { useNanopay } from '@/hooks/useNanopay'
import { isCollateralJob, parseTermsMarker } from '@/lib/credit'
import type { ApiDeliverable, ApiNanopay } from '@/lib/api'
import { AgentMindTerminal, type TermLine } from '@/components/AgentMindTerminal'
import { StatusBadge, SkillBadge } from '@/components/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { keccak256, parseUnits, toHex, type Address } from 'viem'
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
  const deliverable = useDeliverable(jobId)
  const nanopay = useNanopay(jobId)

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
      <CreditTermsJobPanel description={job.description} />
      {deliverable.data ? <VerificationModelBanner kind={deliverable.data.kind} /> : null}
      {deliverable.data ? (
        deliverable.data.kind === 'judged' ? (
          <JudgedDeliverablePanel data={deliverable.data} events={events.data ?? []} />
        ) : (
          <DeliverablePanel data={deliverable.data} />
        )
      ) : null}
      {nanopay.data ? <NanopaymentsPanel data={nanopay.data} /> : null}
    </div>
  )
}

const RISK_TONE: Record<string, string> = {
  high: 'border-danger/30 bg-danger/10 text-danger',
  medium: 'border-warning/30 bg-warning/10 text-warning',
  low: 'border-success/30 bg-success/10 text-success',
}

function DeliverablePanel({ data }: { data: ApiDeliverable }) {
  const rejected = data.verdict?.outcome === 'rejected'
  const checkList: { key: keyof NonNullable<NonNullable<ApiDeliverable['verdict']>['checks']>; label: string }[] = [
    { key: 'schema', label: 'schema' },
    { key: 'rowCount', label: 'row count' },
    { key: 'noDuplicates', label: 'no duplicates' },
    { key: 'checksumMatch', label: 'checksum' },
    { key: 'exactMatch', label: 'exact match' },
  ]
  return (
    <Card className="flex flex-col gap-4 rounded-xl border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[16px] font-semibold text-foreground">Deliverable — real work product</h2>
        {data.verdict ? (
          <Badge
            variant="outline"
            className={cn(
              'rounded-md text-[11px] font-medium tracking-wide',
              rejected ? 'border-danger/30 bg-danger/10 text-danger' : 'border-success/30 bg-success/10 text-success',
            )}
          >
            {rejected ? 'REJECTED BY ARBITER' : 'VERIFIED BY ARBITER'}
          </Badge>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3">
        <Row label="Produced by" value={<ExplorerLink href={addressUrl(data.producedBy)}>{shortAddress(data.producedBy)}</ExplorerLink>} />
        <Row label="Input → output rows" value={<span className="tabular text-foreground">{data.inputRows} → {data.outputRows}</span>} />
        <Row label="Output hash" value={<span className="tabular text-muted-foreground">{data.outputHash.slice(0, 10)}…</span>} />
        {data.submittedTx ? <Row label="Submitted" value={<ExplorerLink href={data.submittedTx}>tx</ExplorerLink>} /> : null}
        {data.verdict?.settleTx ? <Row label={rejected ? 'Rejected' : 'Settled'} value={<ExplorerLink href={data.verdict.settleTx}>tx</ExplorerLink>} /> : null}
      </div>

      {data.verdict?.checks ? (
        <div className="flex flex-col gap-2">
          <span className="text-[12px] uppercase tracking-wider text-muted-foreground/70">Arbiter verification</span>
          <div className="flex flex-wrap gap-1.5">
            {checkList.map(({ key, label }) => {
              const pass = data.verdict!.checks![key]
              return (
                <span
                  key={key}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[12px]',
                    pass ? 'border-success/30 bg-success/10 text-success' : 'border-danger/30 bg-danger/10 text-danger',
                  )}
                >
                  {pass ? '✓' : '✗'} {label}
                </span>
              )
            })}
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] text-[13px]">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground/70">
                <th className="px-3 py-2 text-left font-medium">Address</th>
                <th className="px-3 py-2 text-left font-medium">Balance (USD)</th>
                <th className="px-3 py-2 text-left font-medium">Tx count</th>
                <th className="px-3 py-2 text-left font-medium">Risk</th>
              </tr>
            </thead>
            <tbody>
              {data.output.slice(0, 8).map((r) => (
                <tr key={r.address} className="border-b border-border last:border-0">
                  <td className="tabular px-3 py-2 text-muted-foreground">{shortAddress(r.address)}</td>
                  <td className="tabular px-3 py-2 text-foreground">{r.balanceUsd.toLocaleString('en-US')}</td>
                  <td className="tabular px-3 py-2 text-foreground">{r.txCount.toLocaleString('en-US')}</td>
                  <td className="px-3 py-2">
                    <span className={cn('rounded-md border px-1.5 py-0.5 text-[11px] font-medium', RISK_TONE[r.risk])}>{r.risk}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[12px] text-muted-foreground">
        The agent dedupes the dataset by address and risk-labels each row (deterministic, $0 — no LLM). The arbiter
        re-derives the same result and checks it before releasing escrow.
      </p>
    </Card>
  )
}

function NanopaymentsPanel({ data }: { data: ApiNanopay }) {
  const { onchain, offchain } = data
  return (
    <Card className="flex flex-col gap-4 rounded-xl border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[16px] font-semibold text-foreground">Nanopayments — per-row settlement</h2>
        <Badge variant="outline" className="rounded-md border-neon/30 bg-neon/10 text-[11px] font-medium tracking-wide text-neon">
          Circle Gateway
        </Badge>
      </div>
      <p className="max-w-[70ch] text-[13px] leading-relaxed text-muted-foreground">
        The enrichment agent is also paid <span className="text-foreground">per row</span> over Circle Gateway — a
        machine-to-machine micropayment rail running <span className="text-foreground">alongside</span> the ERC-8183
        escrow, which stays the settlement of record. Each row is a gasless authorization; the only on-chain footprint is
        the one-time deposit and the agent’s withdrawal.
      </p>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-4">
        <Row label="Price / row" value={<span className="tabular text-foreground">{data.pricePerRowUsdc} USDC</span>} />
        <Row label="Rows metered" value={<span className="tabular text-foreground">{offchain.rowCount}</span>} />
        <Row label="Total metered" value={<span className="tabular text-foreground">{offchain.totalPaidUsdc} USDC</span>} />
        <Row label="Paid to agent" value={<ExplorerLink href={addressUrl(data.seller)}>{shortAddress(data.seller)}</ExplorerLink>} />
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-neon/20 bg-neon/5 p-3">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wider text-neon">
          <span className="size-1.5 rounded-full bg-neon" /> On-chain · Arc Testnet
        </span>
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
          <Row
            label="Gateway deposit"
            value={onchain.deposit ? <ExplorerLink href={onchain.deposit}>Arcscan</ExplorerLink> : <span className="text-muted-foreground">—</span>}
          />
          <Row
            label={`Agent withdraw-mint${onchain.withdrawAmountUsdc ? ` · ${onchain.withdrawAmountUsdc} USDC` : ''}`}
            value={onchain.withdrawMint ? <ExplorerLink href={onchain.withdrawMint}>Arcscan</ExplorerLink> : <span className="text-warning">pending batch</span>}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wider text-muted-foreground/80">
          <span className="size-1.5 rounded-full bg-muted-foreground/50" /> Off-chain · gasless · batched by Gateway
        </span>
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="max-h-52 overflow-y-auto">
            <table className="w-full min-w-[420px] text-[13px]">
              <thead className="sticky top-0 bg-surface-1">
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground/70">
                  <th className="px-3 py-2 text-left font-medium">Row</th>
                  <th className="px-3 py-2 text-left font-medium">Amount</th>
                  <th className="px-3 py-2 text-left font-medium">Gateway settlement id</th>
                </tr>
              </thead>
              <tbody>
                {offchain.rows.map((r) => (
                  <tr key={r.index} className="border-b border-border last:border-0">
                    <td className="tabular px-3 py-1.5 text-muted-foreground">{r.index}</td>
                    <td className="tabular px-3 py-1.5 text-foreground">{r.amountUsdc} USDC</td>
                    <td className="tabular px-3 py-1.5 text-muted-foreground">{r.settleId.slice(0, 8)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-[12px] leading-relaxed text-muted-foreground">{offchain.note}</p>
      </div>
    </Card>
  )
}

const TIER_STYLE: Record<'credit' | 'standard' | 'collateral', string> = {
  credit: 'border-success/30 bg-success/10 text-success',
  standard: 'border-neon/30 bg-neon/10 text-neon',
  collateral: 'border-warning/30 bg-warning/10 text-warning',
}

// Credit terms recorded in the job's onchain description — reputation with
// economic consequence, publicly auditable without any new contract. For
// collateral jobs the linked mirror job's live status shows the outcome.
function CreditTermsJobPanel({ description }: { description: string }) {
  const terms = parseTermsMarker(description)
  const isMirror = isCollateralJob(description)
  const { data: colJob } = useReadContract({
    address: ERC8183_ADDRESS,
    abi: erc8183Abi,
    functionName: 'getJob',
    args: terms?.collateralJobId !== undefined ? [terms.collateralJobId] : undefined,
    query: { enabled: terms?.collateralJobId !== undefined, refetchInterval: 8000 },
  })

  if (isMirror) {
    return (
      <Card className="flex flex-col gap-1 rounded-xl border-warning/30 bg-warning/5 p-4">
        <span className="text-[13px] font-semibold text-warning">Collateral mirror job</span>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          This job is an escrow mechanism, not work: an agent locked slashable collateral here (it is the paying
          client; the hiring client is the provider; the arbiter is the evaluator). Settled = slashed to the client;
          rejected = released back to the agent. Excluded from all reputation scores.
        </p>
      </Card>
    )
  }
  if (!terms) return null

  const colStatus = colJob ? Number((colJob as { status: number }).status) : undefined
  const colOutcome =
    colStatus === undefined
      ? null
      : colStatus === JobStatus.Completed
        ? { label: 'SLASHED — forfeited to the client', cls: 'border-danger/30 bg-danger/10 text-danger' }
        : colStatus === JobStatus.Rejected
          ? { label: 'RELEASED — returned to the agent', cls: 'border-success/30 bg-success/10 text-success' }
          : { label: 'LOCKED in escrow', cls: 'border-warning/30 bg-warning/10 text-warning' }

  return (
    <Card className="flex flex-col gap-3 rounded-xl border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[16px] font-semibold text-foreground">Credit terms</h2>
        <Badge variant="outline" className={cn('rounded-md text-[11px] font-medium uppercase tracking-wide', TIER_STYLE[terms.tier])}>
          {terms.tier === 'credit' ? 'Credit — advance + escrow' : terms.tier === 'collateral' ? 'Collateral-backed' : 'Standard escrow'}
        </Badge>
        {terms.score !== undefined ? (
          <span className="text-[13px] text-muted-foreground">
            score at hire: <span className="tabular font-semibold text-foreground">{terms.score}</span>
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
        {terms.advanceTx ? (
          <Row label="Advance (paid directly, before work)" value={<ExplorerLink href={txUrl(terms.advanceTx)}>Arcscan</ExplorerLink>} />
        ) : null}
        {terms.collateralJobId !== undefined ? (
          <Row
            label="Collateral mirror job"
            value={
              <Link to={`/job/${terms.collateralJobId}`} className="tabular text-neon hover:opacity-80">
                #{terms.collateralJobId.toString()}
              </Link>
            }
          />
        ) : null}
        {colOutcome ? (
          <Row
            label="Collateral outcome"
            value={<span className={cn('rounded-md border px-2 py-0.5 text-[12px]', colOutcome.cls)}>{colOutcome.label}</span>}
          />
        ) : null}
      </div>
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Terms follow the agent’s live reputation at hire time and are recorded in this job’s onchain description.
        Enforced by orchestration and self-interest, not chain law.
      </p>
    </Card>
  )
}

// Which verification model settled this job — the contrast is the point: some
// work can be re-derived, some can only be judged.
function VerificationModelBanner({ kind }: { kind: 'deterministic' | 'judged' }) {
  const rederived = kind !== 'judged'
  return (
    <Card className="flex flex-col gap-1 rounded-xl border-border bg-card p-4">
      <span className="text-[13px] font-semibold text-foreground">
        Verification model: {rederived ? 're-derived' : 'judged'}
      </span>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {rederived
          ? 'This work has a single correct answer, so the arbiter independently recomputed the result and compared it byte for byte before settling.'
          : 'This work has no single correct answer, so an independent arbiter model evaluated it against the job spec with a scored rubric and a written reason. The arbiter judges the deliverable — it never re-derives the work.'}
      </p>
    </Card>
  )
}

// Minimal markdown-lite renderer for the agent's memo: headings, bullets and
// paragraphs, no external dependencies, no raw HTML.
function renderMemo(memo: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let bullets: string[] = []
  const flush = (key: string) => {
    if (bullets.length > 0) {
      nodes.push(
        <ul key={key} className="ml-5 list-disc space-y-1">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>,
      )
      bullets = []
    }
  }
  memo.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\*\*/g, '').trimEnd()
    if (/^#{1,4}\s+/.test(line)) {
      flush(`ul-${i}`)
      nodes.push(
        <h4 key={i} className="pt-2 text-[14px] font-semibold text-foreground first:pt-0">
          {line.replace(/^#{1,4}\s+/, '')}
        </h4>,
      )
    } else if (/^\s*[-*]\s+/.test(line)) {
      bullets.push(line.replace(/^\s*[-*]\s+/, ''))
    } else if (line.trim() === '') {
      flush(`ul-${i}`)
    } else {
      flush(`ul-${i}`)
      nodes.push(
        <p key={i} className="leading-relaxed">
          {line}
        </p>,
      )
    }
  })
  flush('ul-end')
  return nodes
}

function JudgedDeliverablePanel({ data, events }: { data: ApiDeliverable; events: JobEvent[] }) {
  const rejected = data.verdict?.outcome === 'rejected'
  const reasoning = data.verdict?.reasoning

  // The credibility check: recompute keccak(reasoning) locally and compare it to
  // the reason committed onchain in the settle event — not to anything the API says.
  const settleEvent = events.find((e) => e.name === 'JobCompleted' || e.name === 'JobRejected')
  const onchainReason = settleEvent ? String(settleEvent.args?.reason ?? '') : null
  const computedHash = reasoning ? keccak256(toHex(reasoning)) : null
  const hashState: 'match' | 'mismatch' | 'pending' =
    computedHash && onchainReason ? (computedHash.toLowerCase() === onchainReason.toLowerCase() ? 'match' : 'mismatch') : 'pending'

  return (
    <Card className="flex flex-col gap-4 rounded-xl border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[16px] font-semibold text-foreground">Deliverable — analyst memo</h2>
        {data.verdict ? (
          <Badge
            variant="outline"
            className={cn(
              'rounded-md text-[11px] font-medium tracking-wide',
              rejected ? 'border-danger/30 bg-danger/10 text-danger' : 'border-success/30 bg-success/10 text-success',
            )}
          >
            {rejected ? 'REJECTED BY ARBITER' : 'PASSED BY ARBITER'}
          </Badge>
        ) : (
          <Badge variant="outline" className="rounded-md border-warning/30 bg-warning/10 text-[11px] font-medium tracking-wide text-warning">
            AWAITING VERDICT
          </Badge>
        )}
      </div>

      <p className="max-w-[75ch] text-[13px] leading-relaxed text-muted-foreground">
        <span className="text-foreground">Job spec:</span> {data.spec}
      </p>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3">
        <Row label="Produced by" value={<ExplorerLink href={addressUrl(data.producedBy)}>{shortAddress(data.producedBy)}</ExplorerLink>} />
        {data.agentModel ? <Row label="Agent model" value={<span className="text-cream">{data.agentModel}</span>} /> : null}
        <Row label="Memo hash" value={<span className="tabular text-muted-foreground">{data.outputHash.slice(0, 10)}…</span>} />
        {data.submittedTx ? <Row label="Submitted" value={<ExplorerLink href={data.submittedTx}>tx</ExplorerLink>} /> : null}
        {data.verdict?.settleTx ? <Row label={rejected ? 'Rejected' : 'Settled'} value={<ExplorerLink href={data.verdict.settleTx}>tx</ExplorerLink>} /> : null}
        {data.verdict?.deliverableHashMatch !== undefined ? (
          <Row
            label="Integrity"
            value={
              data.verdict.deliverableHashMatch ? (
                <span className="text-success">memo hashes to onchain submission ✓</span>
              ) : (
                <span className="text-danger">hash mismatch ✗</span>
              )
            }
          />
        ) : null}
      </div>

      {data.memo ? (
        <div className="max-h-80 overflow-y-auto rounded-lg border border-border bg-surface-1 p-4 text-[13px] text-muted-foreground">
          <div className="flex flex-col gap-2">{renderMemo(data.memo)}</div>
        </div>
      ) : null}

      {data.verdict?.rubric ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] uppercase tracking-wider text-muted-foreground/70">Arbiter’s evaluation</span>
            {data.verdict.arbiterModel ? (
              <Badge variant="outline" className="rounded-md border-neon/30 bg-neon/10 text-[11px] font-normal text-neon">
                {data.verdict.arbiterModel} — independent model family
              </Badge>
            ) : null}
          </div>
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[440px] text-[13px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground/70">
                    <th className="px-3 py-2 text-left font-medium">Criterion</th>
                    <th className="px-3 py-2 text-left font-medium">Score</th>
                    <th className="px-3 py-2 text-left font-medium">Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {data.verdict.rubric.map((r) => (
                    <tr key={r.criterion} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-foreground">{r.criterion}</td>
                      <td className={cn('tabular px-3 py-2 font-semibold', r.score >= Math.ceil(r.max * 0.6) ? 'text-success' : 'text-danger')}>
                        {r.score}/{r.max}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{r.comment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {reasoning ? (
        <div className="flex flex-col gap-2">
          <span className="text-[12px] uppercase tracking-wider text-muted-foreground/70">Written reasoning (attested onchain)</span>
          <p className="max-w-[75ch] rounded-lg border-l-2 border-neon/50 bg-surface-1 px-4 py-3 text-[13px] leading-relaxed text-foreground">
            {reasoning}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            {hashState === 'match' ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/10 px-2 py-0.5 text-success">
                ✓ keccak of this reasoning matches the onchain verdict
              </span>
            ) : hashState === 'mismatch' ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/10 px-2 py-0.5 text-danger">
                ✗ reasoning does not hash to the onchain verdict
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-muted-foreground">
                verifying against onchain events…
              </span>
            )}
            {settleEvent ? <ExplorerLink href={txUrl(settleEvent.txHash)}>verdict tx</ExplorerLink> : null}
          </div>
        </div>
      ) : null}
    </Card>
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
