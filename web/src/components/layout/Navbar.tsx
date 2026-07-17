import { NavLink } from 'react-router-dom'
import { Logo } from '@/components/brand/Logo'
import { BuiltOnArc } from '@/components/brand/BuiltOnArc'
import { WalletButton } from '@/components/WalletButton'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/', label: 'Showcase', end: true },
  { to: '/marketplace', label: 'Marketplace' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/arbiter', label: 'Arbiter' },
]

export function Navbar() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center gap-6 px-6">
        <NavLink to="/" className="flex items-center gap-2" aria-label="AgentScore home">
          <Logo size={26} />
          <span className="text-[17px] font-semibold tracking-[-0.01em] text-foreground">AgentScore</span>
        </NavLink>
        <BuiltOnArc className="hidden sm:inline-flex" />

        <nav className="ml-auto hidden items-center gap-1 md:flex" aria-label="Primary">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'rounded-[9px] px-3 py-2 text-[14px] font-medium transition-colors',
                  isActive ? 'bg-surface-2 text-foreground' : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto md:ml-2">
          <WalletButton />
        </div>
      </div>
    </header>
  )
}
