import type { ReactNode } from 'react'
import type { PillSpec } from '../lib/format'
import './ui.css'

export function Panel({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'section' | 'article' | 'li'
}) {
  return <Tag className={`panel ${className}`}>{children}</Tag>
}

export function SectionPrefix({ children }: { children: ReactNode }) {
  return <div className="section-prefix">{children}</div>
}

export function MetricLabel({ children }: { children: ReactNode }) {
  return <span className="metric-label">{children}</span>
}

export function Pill({ spec }: { spec: PillSpec }) {
  return <span className={`pill pill-${spec.tone}`}>{spec.label}</span>
}

export function ExplorerLink({ href, children = 'arcscan' }: { href: string; children?: ReactNode }) {
  return (
    <a className="explorer-link" href={href} target="_blank" rel="noreferrer noopener">
      {children} ↗
    </a>
  )
}

export function MetricCard({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Panel className="metric-card">
      <MetricLabel>{label}</MetricLabel>
      <div className="metric-value mono">{value}</div>
      {hint ? <div className="metric-hint">{hint}</div> : null}
    </Panel>
  )
}

/** Score dial 0–100. Color follows the score band (mint / amber / danger). */
export function ScoreDial({ score, size = 168 }: { score: number; size?: number }) {
  const stroke = 10
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, score))
  const dash = (clamped / 100) * circumference
  const color = clamped >= 70 ? 'var(--accent)' : clamped >= 40 ? 'var(--warning)' : 'var(--danger)'
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Score ${clamped} out of 100`}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference - dash}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" className="mono" fontSize={size * 0.28} fill="var(--text)">
        {clamped}
      </text>
      <text x="50%" y="66%" textAnchor="middle" dominantBaseline="middle" className="mono" fontSize={size * 0.075} fill="var(--text-muted)">
        / 100
      </text>
    </svg>
  )
}

export function StatusMessage({
  tone = 'neutral',
  title,
  children,
  action,
}: {
  tone?: 'neutral' | 'negative' | 'warning'
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <Panel className={`status-message status-${tone}`}>
      <div className="status-title">{title}</div>
      {children ? <p className="status-body">{children}</p> : null}
      {action ? <div className="status-action">{action}</div> : null}
    </Panel>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner-dot" />
      <span className="mono spinner-label">{label}</span>
    </div>
  )
}
