import { NavLink } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { Logo } from '@/components/brand/Logo'
import { BuiltOnArc } from '@/components/brand/BuiltOnArc'
import { ERC8183_ADDRESS, EXPLORER_URL, FAUCET_URL } from '@/lib/config'

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-0.5 text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
      <ArrowUpRight className="size-3" />
    </a>
  )
}

function Soon({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground/70">
      {children}
      <span className="rounded bg-surface-2 px-1 text-[10px] text-muted-foreground">Soon</span>
    </span>
  )
}

function InLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink to={to} className="text-muted-foreground transition-colors hover:text-foreground">
      {children}
    </NavLink>
  )
}

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border bg-surface-1">
      <div className="mx-auto grid w-full max-w-[1200px] grid-cols-2 gap-8 px-6 py-14 md:grid-cols-4">
        <div className="col-span-2 flex flex-col gap-3 md:col-span-1">
          <div className="flex items-center gap-2">
            <Logo size={24} />
            <span className="text-[16px] font-semibold text-foreground">AgentScore</span>
          </div>
          <p className="max-w-[28ch] text-[13px] leading-relaxed text-muted-foreground">
            Verifiable reputation and escrowed hiring for autonomous agents.
          </p>
          <BuiltOnArc />
        </div>

        <nav className="flex flex-col gap-3 text-[14px]" aria-label="Product">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground/70">Product</span>
          <InLink to="/">Showcase</InLink>
          <InLink to="/marketplace">Marketplace</InLink>
          <InLink to="/dashboard">Dashboard</InLink>
          <InLink to="/arbiter">Arbiter</InLink>
        </nav>

        <nav className="flex flex-col gap-3 text-[14px]" aria-label="Developers">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground/70">Developers</span>
          <ExtLink href="https://docs.arc.io">Docs</ExtLink>
          <ExtLink href={`${EXPLORER_URL}/address/${ERC8183_ADDRESS}`}>ERC-8183 contract</ExtLink>
          <ExtLink href={FAUCET_URL}>Testnet faucet</ExtLink>
          <ExtLink href="https://github.com/devorun/agentscore">GitHub</ExtLink>
        </nav>

        <nav className="flex flex-col gap-3 text-[14px]" aria-label="Legal">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground/70">Legal</span>
          <Soon>Terms of escrow</Soon>
          <Soon>Privacy</Soon>
        </nav>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-1 px-6 py-6 text-[12px] text-muted-foreground/80">
          <p>Arc is a trademark of Circle Internet Group, Inc. AgentScore is not affiliated with or endorsed by Circle.</p>
          <p>
            Testnet software, unaudited. All funds are valueless test tokens from the faucet. We recommend using a
            dedicated testnet wallet.
          </p>
        </div>
      </div>
    </footer>
  )
}
