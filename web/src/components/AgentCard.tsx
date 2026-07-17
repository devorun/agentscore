import { useNavigate } from 'react-router-dom'
import { Briefcase, Wallet } from 'lucide-react'
import type { ShowcaseAgent } from '@/lib/agents'
import { ScoreDial } from '@/components/ScoreDial'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { shortAddress } from '@/lib/format'

export function AgentCard({ agent }: { agent: ShowcaseAgent }) {
  const navigate = useNavigate()

  return (
    <Card className="group flex flex-col gap-5 rounded-xl border-border bg-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-neon/40 hover:bg-surface-2">
      <div className="flex items-start gap-3">
        <div
          className="flex size-11 shrink-0 items-center justify-center rounded-[10px] text-[17px] font-semibold"
          style={{ backgroundColor: `${agent.accent}22`, color: agent.accent }}
          aria-hidden="true"
        >
          {agent.name.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[16px] font-semibold text-foreground">{agent.name}</h3>
            {agent.source === 'demo' ? (
              <Badge
                variant="outline"
                className="h-5 border-border bg-surface-2 px-1.5 text-[10px] font-medium tracking-wide text-muted-foreground"
              >
                Demo
              </Badge>
            ) : null}
          </div>
          <p className="tabular mt-0.5 text-[12px] text-muted-foreground">{shortAddress(agent.address)}</p>
        </div>
        <ScoreDial score={agent.score} size={56} stroke={5} />
      </div>

      <p className="text-[14px] leading-relaxed text-muted-foreground">{agent.tagline}</p>

      <div className="flex flex-wrap gap-1.5">
        {agent.skills.map((skill) => (
          <Badge key={skill} variant="secondary" className="rounded-md bg-surface-2 text-[12px] font-normal text-cream">
            {skill}
          </Badge>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4 text-[13px]">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Briefcase className="size-3.5" />
          <span className="tabular text-foreground">{agent.jobsCompleted}</span> jobs
        </span>
        <span className="text-muted-foreground">
          from <span className="tabular font-semibold text-foreground">{agent.pricePerJobUsdc} USDC</span>/job
        </span>
      </div>

      <div className="flex gap-2">
        <Button
          className="h-9 flex-1 rounded-[9px] bg-primary font-medium text-primary-foreground hover:bg-primary/90"
          onClick={() => navigate(`/hire/${agent.address}`)}
        >
          <Wallet className="size-4" />
          Hire
        </Button>
        <Button
          variant="outline"
          className="h-9 rounded-[9px] border-border bg-transparent text-foreground hover:bg-surface-2"
          onClick={() => navigate(`/agent/${agent.address}`)}
        >
          Profile
        </Button>
      </div>
    </Card>
  )
}
