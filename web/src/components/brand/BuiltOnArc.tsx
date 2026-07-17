/**
 * "Built on Arc" lockup. The brief permits the official Arc logomark pulled
 * unaltered from Circle's Brand Kit, but forbids recreating/recoloring it. We
 * cannot fetch and verify that asset here, so per the brief's fallback we use
 * the text lockup only. Drop the official SVG into this component when available.
 */
export function BuiltOnArc({ className }: { className?: string }) {
  return (
    <span
      className={
        'inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-muted-foreground ' +
        (className ?? '')
      }
    >
      <span className="size-1.5 rounded-full bg-arc" aria-hidden="true" />
      Built on Arc
    </span>
  )
}
