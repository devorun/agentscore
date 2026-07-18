import { useEffect, useRef, useState } from 'react'
import { Terminal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

export interface TermLine {
  text: string
  tone?: 'default' | 'muted' | 'accent' | 'success' | 'warning' | 'danger'
  /** Optional real Arcscan tx link rendered after the line. */
  href?: string
}

const TONE: Record<NonNullable<TermLine['tone']>, string> = {
  default: 'text-[#d7d7cf]',
  muted: 'text-[#77776f]',
  accent: 'text-[#4d8df0]',
  success: 'text-[#6ee7b7]',
  warning: 'text-[#fbbf24]',
  danger: 'text-[#f87171]',
}

/**
 * "Agent's Mind" — a terminal-aesthetic panel that streams an agent/arbiter's
 * steps. Monospace and a fixed dark surface are intentional here (and, per the
 * brief, allowed ONLY in this panel). Auto-plays with zero human interaction.
 */
export function AgentMindTerminal({
  lines,
  simulation = true,
  animate = true,
}: {
  lines: TermLine[]
  simulation?: boolean
  animate?: boolean
}) {
  const [shown, setShown] = useState(animate ? 0 : lines.length)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!animate) {
      setShown(lines.length)
      return
    }
    setShown(0)
    let i = 0
    const id = setInterval(() => {
      i += 1
      setShown(i)
      if (i >= lines.length) clearInterval(id)
    }, 650)
    return () => clearInterval(id)
  }, [lines, animate])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [shown])

  return (
    <div className="overflow-hidden rounded-xl border border-[#26262b] bg-[#0b0b0e]">
      <div className="flex items-center justify-between border-b border-[#1c1c20] px-4 py-2.5">
        <div className="flex items-center gap-2 text-[13px] text-[#d7d7cf]">
          <Terminal className="size-4 text-[#4d8df0]" />
          Agent’s Mind
        </div>
        {simulation ? (
          <Badge variant="outline" className="border-[#fbbf24]/30 bg-[#fbbf24]/10 text-[11px] text-[#fbbf24]">
            Simulation
          </Badge>
        ) : (
          <Badge variant="outline" className="border-[#6ee7b7]/30 bg-[#6ee7b7]/10 text-[11px] text-[#6ee7b7]">
            Live
          </Badge>
        )}
      </div>
      <div
        ref={scrollRef}
        className="h-[320px] overflow-y-auto px-4 py-3"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.7 }}
      >
        {lines.slice(0, shown).map((line, i) => (
          <div key={i} className={TONE[line.tone ?? 'default']}>
            {line.text}
            {line.href ? (
              <a
                href={line.href}
                target="_blank"
                rel="noreferrer noopener"
                className="ml-2 text-[#4d8df0] hover:underline"
              >
                tx ↗
              </a>
            ) : null}
          </div>
        ))}
        {shown < lines.length ? <span className="inline-block h-3.5 w-2 animate-pulse bg-[#4d8df0] align-middle" /> : null}
      </div>
    </div>
  )
}
