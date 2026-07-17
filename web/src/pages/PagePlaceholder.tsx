import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'

/**
 * A polished, non-empty holding state for pages that land in a later build pass.
 * Shows the page's purpose plus a skeleton preview so no route is ever blank.
 */
export function PagePlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-[30px] font-semibold -tracking-[0.01em] text-foreground">{title}</h1>
          <Badge variant="outline" className="border-border bg-surface-2 text-[11px] text-muted-foreground">
            In progress
          </Badge>
        </div>
        <p className="max-w-[64ch] text-[15px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="flex flex-col gap-4 rounded-xl border-border bg-card p-5">
            <div className="flex items-center gap-3">
              <Skeleton className="size-11 rounded-[10px] bg-surface-2" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-24 bg-surface-2" />
                <Skeleton className="h-3 w-16 bg-surface-2" />
              </div>
            </div>
            <Skeleton className="h-3 w-full bg-surface-2" />
            <Skeleton className="h-3 w-4/5 bg-surface-2" />
            <div className="flex gap-2">
              <Skeleton className="h-9 flex-1 rounded-[9px] bg-surface-2" />
              <Skeleton className="h-9 w-20 rounded-[9px] bg-surface-2" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
