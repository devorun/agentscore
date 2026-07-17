import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { WalletButton } from './WalletButton'
import { NetworkGuard } from './NetworkGuard'
import './layout.css'

// Nav items are added here as each page ships (phase gates). Controls for
// unbuilt features must not render, so this list stays empty until Phase 3+.
const NAV: { to: string; label: string }[] = []

export function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <NavLink to="/" className="brand" aria-label="AgentScore home">
            <span className="brand-mark" aria-hidden="true">
              A
            </span>
            <span className="brand-name">AgentScore</span>
            <span className="built-on-badge mono">Built on Arc</span>
          </NavLink>

          {NAV.length > 0 ? (
            <nav className="site-nav" aria-label="Primary">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `nav-link${isActive ? ' nav-link-active' : ''}`}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          ) : null}

          <div className="header-actions">
            <WalletButton />
          </div>
        </div>
        <NetworkGuard />
      </header>

      <main className="site-main">{children}</main>

      <footer className="site-footer">
        <div className="footer-inner">
          <p>AgentScore — an independent project built on Arc, running on Arc Testnet.</p>
          <p className="footer-muted">
            Arc is a trademark of Circle Internet Group, Inc. AgentScore is not affiliated with or endorsed by Circle.
          </p>
          <p className="footer-muted">
            Testnet software, unaudited. All funds are valueless test tokens from the faucet. We recommend using a
            dedicated testnet wallet.
          </p>
        </div>
      </footer>
    </>
  )
}
