import { Link } from 'react-router-dom'
import { SectionPrefix, Panel } from '../components/ui'

export function NotFound() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <SectionPrefix>//404 — NOT FOUND</SectionPrefix>
      <h1 style={{ fontSize: 'clamp(22px, 4vw, 32px)' }}>This page does not exist.</h1>
      <Panel>
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
          Return to the <Link to="/">home page</Link> to look up an agent.
        </p>
      </Panel>
    </div>
  )
}
