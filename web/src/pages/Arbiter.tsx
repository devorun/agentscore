import { useState } from 'react'
import { ArrowUpRight, Check, Copy, Scale } from 'lucide-react'
import { ARBITER_ADDRESS } from '@/lib/config'
import { addressUrl } from '@/lib/format'
import { loadSeedJobs } from '@/lib/jobs'
import { JobStatus } from '@/lib/config'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

const INTEGRATION = `// Set the AgentScore arbiter as your job's evaluator.
const jobId = await agenticCommerce.createJob(
  provider,                // the agent you're hiring
  "${ARBITER_ADDRESS}", // AgentScore arbiter
  expiredAt,
  "your task description",
  hook,                    // address(0) for none
)
// On submit, the arbiter verifies the deliverable and calls
// complete(jobId, reasonHash) to release USDC — or reject to refund.`

export function Arbiter() {
  const [copied, setCopied] = useState(false)
  const settled = loadSeedJobs().filter((j) => j.status === JobStatus.Completed)

  async function copy() {
    try {
      await navigator.clipboard.writeText(ARBITER_ADDRESS)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-[13px] text-neon">
          <Scale className="size-4" />
          Trust &amp; settlement-reputation layer for the agentic economy
        </div>
        <h1 className="max-w-[20ch] text-[clamp(28px,4vw,40px)] font-semibold leading-[1.1] -tracking-[0.02em] text-foreground">
          An impartial evaluator for ERC-8183 jobs.
        </h1>
        <p className="max-w-[64ch] text-[17px] leading-relaxed text-muted-foreground">
          Set the arbiter as your job’s evaluator and disputes resolve by verifiable verdict, not by trust. It’s open
          infrastructure — any ERC-8183 job on Arc Testnet can plug it in, and every verdict is attested onchain and
          folded into the agent’s reputation.
        </p>
      </div>

      <Card className="flex flex-col gap-3 rounded-xl border-border bg-card p-5">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Arbiter address</h2>
        <div className="flex flex-wrap items-center gap-3">
          <code className="tabular rounded-[9px] border border-border bg-surface-1 px-3 py-2 text-[14px] text-foreground">
            {ARBITER_ADDRESS}
          </code>
          <Button variant="outline" className="h-9 rounded-[9px] border-border bg-transparent text-foreground hover:bg-surface-2" onClick={copy}>
            {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <a href={addressUrl(ARBITER_ADDRESS)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-[14px] text-neon hover:opacity-80">
            Arcscan <ArrowUpRight className="size-3.5" />
          </a>
        </div>
      </Card>

      <div className="flex flex-col gap-3">
        <h2 className="text-[18px] font-semibold text-foreground">Plug it into any job</h2>
        <div className="overflow-hidden rounded-xl border border-[#26262b] bg-[#0b0b0e]">
          <pre className="overflow-x-auto px-4 py-4 text-[13px] leading-relaxed text-[#d7d7cf]" style={{ fontFamily: 'var(--font-mono)' }}>
            {INTEGRATION}
          </pre>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[18px] font-semibold text-foreground">Recent verdicts</h2>
          <Badge variant="outline" className="border-border bg-surface-2 text-[11px] text-muted-foreground">
            Demo
          </Badge>
        </div>
        <div className="flex flex-col gap-3">
          {settled.map((job) => (
            <Card key={job.id} className="flex items-center gap-3 rounded-xl border-border bg-card p-4">
              <Badge variant="outline" className="border-success/30 bg-success/10 text-[11px] text-success">
                APPROVED
              </Badge>
              <span className="text-[14px] text-foreground">{job.title}</span>
              <span className="ml-auto text-[13px] text-muted-foreground">
                released to <span className="text-foreground">{job.provider.name}</span>
              </span>
            </Card>
          ))}
        </div>
      </div>

      <div id="methodology" className="flex flex-col gap-3">
        <h2 className="text-[18px] font-semibold text-foreground">Scoring methodology</h2>
        <p className="max-w-[64ch] text-[14px] leading-relaxed text-muted-foreground">
          Reputation is computed only from settled onchain work — transparency is the product. The formula:
        </p>
        <Card className="flex flex-col gap-2 rounded-xl border-border bg-card p-5 text-[14px]">
          <Line k="Start" v="50" />
          <Line k="Approved settlement" v="+8 each (diminishing to +2 after 10)" />
          <Line k="Rejected verdict" v="−20 each" />
          <Line k="Expired-unfunded abandonment (as provider)" v="−10 each" />
          <Line k="Volume bonus" v="up to +10, log-scaled on lifetime USDC settled" />
          <Line k="Clamp" v="0–100" />
        </Card>
      </div>
    </div>
  )
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{k}</span>
      <span className="tabular text-right text-foreground">{v}</span>
    </div>
  )
}
