import { SectionPrefix, Panel } from '../components/ui'

// Honest interim state for routes whose interactive flow lands in a later phase
// gate. No fabricated data — states what is coming and when.
export function ComingSoon({ phase, title, note }: { phase: string; title: string; note: string }) {
  return (
    <div className="agent-section" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <SectionPrefix>//{phase.toUpperCase().replace(' ', '.')} — IN PROGRESS</SectionPrefix>
      <h1 style={{ fontSize: 'clamp(22px, 4vw, 32px)', maxWidth: '24ch' }}>{title}</h1>
      <Panel>
        <p style={{ margin: 0, color: 'var(--text-secondary)', maxWidth: '60ch' }}>{note}</p>
      </Panel>
    </div>
  )
}
