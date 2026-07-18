import type { JobStatusValue } from '@/lib/config'
import { statusPill, type PillSpec } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const TONE: Record<PillSpec['tone'], string> = {
  positive: 'border-success/30 bg-success/10 text-success',
  pending: 'border-warning/30 bg-warning/10 text-warning',
  negative: 'border-danger/30 bg-danger/10 text-danger',
  neutral: 'border-border bg-surface-2 text-muted-foreground',
  muted: 'border-border bg-transparent text-muted-foreground/70',
}

export function StatusBadge({ status, className }: { status: JobStatusValue; className?: string }) {
  const spec = statusPill(status)
  return (
    <Badge variant="outline" className={cn('rounded-md text-[11px] font-medium tracking-wide', TONE[spec.tone], className)}>
      {spec.label}
    </Badge>
  )
}

export function SkillBadge({ skill }: { skill: string }) {
  return (
    <Badge variant="secondary" className="rounded-md bg-surface-2 text-[12px] font-normal text-cream">
      {skill}
    </Badge>
  )
}
