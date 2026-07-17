import { scoreBand } from '@/lib/agents'

const BAND_COLOR: Record<string, string> = {
  high: 'var(--neon)',
  mid: 'var(--warning)',
  low: 'var(--danger)',
}

/** Reputation score 0–100 as a gauge dial. Color follows the score band. */
export function ScoreDial({ score, size = 96, stroke = 8 }: { score: number; size?: number; stroke?: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const sweep = 0.75 // 270° gauge
  const track = circumference * sweep
  const value = track * (clamped / 100)
  const color = BAND_COLOR[scoreBand(clamped)]

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Reputation score ${clamped} of 100`}>
      <g transform={`rotate(135 ${size / 2} ${size / 2})`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${track} ${circumference - track}`}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${value} ${circumference - value}`}
        />
      </g>
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="tabular fill-foreground"
        style={{ fontSize: size * 0.3, fontWeight: 600 }}
      >
        {clamped}
      </text>
    </svg>
  )
}
