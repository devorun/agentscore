/** AgentScore logomark — a geometric score-gauge, readable at 16px. */
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
      aria-label="AgentScore"
    >
      <g transform="translate(16 16)">
        <circle
          r="11"
          fill="none"
          stroke="var(--border)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="51.8 69.1"
          transform="rotate(135)"
        />
        <circle
          r="11"
          fill="none"
          stroke="var(--neon)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="38 69.1"
          transform="rotate(135)"
        />
        <circle r="2.8" fill="var(--neon)" />
      </g>
    </svg>
  )
}

/** Wordmark lockup: logomark + "AgentScore". */
export function BrandLockup({ className }: { className?: string }) {
  return (
    <span className={className}>
      <Logo size={26} />
      <span className="text-[17px] font-semibold tracking-[-0.01em] text-foreground">AgentScore</span>
    </span>
  )
}
