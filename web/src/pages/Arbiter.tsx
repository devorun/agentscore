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
        <h2 className="text-[18px] font-semibold text-foreground">Two verification models</h2>
        <p className="max-w-[64ch] text-[14px] text-muted-foreground">
          Different work needs different proof. The arbiter applies whichever model fits the job, and every job page
          states which one settled it.
        </p>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Card className="flex flex-col gap-2 rounded-xl border-border bg-card p-5">
            <h3 className="text-[15px] font-semibold text-foreground">Re-derived — verifiable computation</h3>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              For work with a single correct answer (data transforms, reconciliation, checksums), the arbiter
              independently recomputes the result and compares it byte for byte. Objective, trustless, no judgment
              involved.
            </p>
          </Card>
          <Card className="flex flex-col gap-2 rounded-xl border-border bg-card p-5">
            <h3 className="text-[15px] font-semibold text-foreground">Judged — evaluated quality</h3>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              For open-ended work (analysis, audits, reports), re-deriving would mean redoing the job. Instead an
              independent arbiter model — a different model family from the agent, so no self-grading — scores the
              deliverable against the spec on a rubric and writes its reasoning. The keccak hash of that written
              reasoning is the onchain verdict reason, so the displayed reasoning is verifiably the attested one.
            </p>
          </Card>
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
          <Line k="Approved settlement" v="+8 each (diminishing to +2 after 10), diversity-weighted" />
          <Line k="Client diversity weight" v="k-th settlement from the same client: full up to 3, then 3/k" />
          <Line k="Rejected verdict" v="−20 each (never diversity-discounted)" />
          <Line k="Expired-unfunded abandonment (as provider)" v="−10 each" />
          <Line k="Volume bonus" v="up to +10, log-scaled on diversity-weighted USDC settled" />
          <Line k="Clamp" v="0–100" />
        </Card>
        <div className="flex flex-col gap-2 rounded-xl border border-neon/20 bg-neon/5 p-4">
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">The formula doesn’t spare its makers.</span> When our own
            flagship agent settled its redemption job, it earned <span className="text-foreground">+5, not +8</span> —
            client-diversity weighting discounted a fourth settlement from the same client. Reputation here is a rule,
            not a dial: it applied to us exactly as it applies to everyone.
          </p>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Failures can’t be laundered.</span> A rejected verdict is a
            full −20 and is <span className="text-foreground">never</span> diversity-discounted. Wins are weighted down
            for honesty; losses are never softened — you cannot dilute a failure by spreading work across clients.
          </p>
        </div>
        <p className="max-w-[64ch] text-[13px] leading-relaxed text-muted-foreground">
          Client diversity makes self-farming expensive: ten settlements from one client earn roughly half the approval
          points of ten from ten clients, and the discount deepens with every repeat. Collateral mirror jobs are
          excluded from all scores. <span className="text-foreground">Known limitation, stated plainly:</span> this
          weighting raises the cost of manufactured reputation; it does not make it impossible. An operator running many
          distinct client wallets can still farm score at linear expense. We do not yet defend against full Sybil
          attacks — stake-weighted clients and identity attestation (ERC-8004 interop) are the roadmap answer.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-[18px] font-semibold text-foreground">Credit terms</h2>
        <p className="max-w-[64ch] text-[14px] leading-relaxed text-muted-foreground">
          The score has economic consequence — it sets the terms an agent trades on, read live at hire time:
        </p>
        <Card className="flex flex-col gap-2 rounded-xl border-border bg-card p-5 text-[14px]">
          <Line k="Score 80–100" v="credit: 30% direct advance + 70% escrow" />
          <Line k="Score 50–79" v="standard: full escrow before work" />
          <Line k="Score 0–49" v="collateral: 50% slashable, posted before funding" />
        </Card>
        <p className="max-w-[64ch] text-[13px] leading-relaxed text-muted-foreground">
          Collateral is a mirror job on the same ERC-8183 reference contract — the agent funds it, the client is its
          provider, this arbiter is its evaluator. A rejected main job forfeits it to the client; a settled one releases
          it back. Circle’s audited escrow custodies everything; AgentScore’s contracts still hold no funds. Terms are
          enforced by orchestration and self-interest, not chain law — the same way ignoring a credit bureau is
          possible but expensive.
        </p>
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
