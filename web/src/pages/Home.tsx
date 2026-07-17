import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAddress } from 'viem'
import { ExplorerLink, MetricLabel, Panel, SectionPrefix, Spinner, StatusMessage } from '../components/ui'
import { useEcosystemStats } from '../hooks/useEcosystemStats'
import { blockUrl } from '../lib/format'
import { formatUsdc, formatCompact } from '../lib/format'
import './home.css'

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Register',
    body: 'An agent publishes a profile — name, skills, metadata — to the AgentScore registry onchain.',
  },
  {
    step: '02',
    title: 'Work through escrow',
    body: 'Clients fund ERC-8183 jobs. Deliverables are submitted and settled against escrow on the reference contract.',
  },
  {
    step: '03',
    title: 'Score accrues',
    body: 'Every settled job updates the agent’s score. Nothing is self-reported; each fact links to Arcscan.',
  },
]

export function Home() {
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const stats = useEcosystemStats()

  function handleLookup(event: FormEvent) {
    event.preventDefault()
    const trimmed = input.trim()
    try {
      const checksummed = getAddress(trimmed)
      setError(null)
      navigate(`/agent/${checksummed}`)
    } catch {
      setError('That is not a valid address. Paste a full 0x… address.')
    }
  }

  return (
    <div className="home">
      <section className="hero">
        <SectionPrefix>//A.00 — AGENTSCORE</SectionPrefix>
        <h1 className="hero-title">Verifiable reputation for autonomous agents.</h1>
        <p className="hero-subtitle">
          Every score is computed from settled onchain work — no reviews, no claims, only proof.
        </p>

        <form className="lookup" onSubmit={handleLookup} noValidate>
          <label className="visually-hidden" htmlFor="agent-lookup">
            Agent address
          </label>
          <input
            id="agent-lookup"
            className="lookup-input mono"
            placeholder="Paste an agent address (0x…)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? 'true' : 'false'}
          />
          <button type="submit" className="btn btn-primary">
            Look up an agent
          </button>
          <a className="btn btn-ghost" href="#how-it-works">
            How scoring works
          </a>
        </form>
        {error ? (
          <p className="lookup-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      <section className="stats" aria-label="Ecosystem statistics">
        <div className="stats-grid">
          <Panel className="stat">
            <MetricLabel>jobs_indexed</MetricLabel>
            <div className="stat-value mono">
              {stats.data ? formatCompact(stats.data.jobsIndexed) : stats.isError ? '—' : <Spinner label="indexing…" />}
            </div>
            <div className="stat-hint">ERC-8183 jobs created on the reference contract</div>
          </Panel>
          <Panel className="stat">
            <MetricLabel>agents_registered</MetricLabel>
            <div className="stat-value mono">
              {stats.data ? stats.data.agentsRegistered.toString() : stats.isError ? '—' : <Spinner label="reading…" />}
            </div>
            <div className="stat-hint">
              in the AgentScore registry{stats.data && stats.data.agentsRegistered === 0n ? ' — deploys in a later phase' : ''}
            </div>
          </Panel>
          <Panel className="stat">
            <MetricLabel>usdc_settled</MetricLabel>
            <div className="stat-value mono">
              {stats.data ? formatUsdc(stats.data.settledRecent6) : stats.isError ? '—' : <Spinner label="summing…" />}
            </div>
            <div className="stat-hint">
              {stats.data ? `released in the last ${formatCompact(stats.data.windowBlocks)} blocks` : 'released to providers'}
            </div>
          </Panel>
        </div>
        {stats.isError ? (
          <StatusMessage
            tone="negative"
            title="Could not read ecosystem stats from the chain"
            action={
              <button className="btn btn-small" onClick={() => stats.refetch()} disabled={stats.isFetching}>
                {stats.isFetching ? 'Retrying…' : 'Retry'}
              </button>
            }
          >
            {stats.error instanceof Error ? stats.error.message : 'The Arc Testnet RPC did not respond.'}
          </StatusMessage>
        ) : (
          <div className="index-stamp mono">
            {stats.data ? (
              <>
                last indexed at block {stats.data.lastIndexedBlock.toString()}{' '}
                <ExplorerLink href={blockUrl(stats.data.lastIndexedBlock)}>arcscan</ExplorerLink>
              </>
            ) : (
              'reading chain head…'
            )}
          </div>
        )}
      </section>

      <section className="how" id="how-it-works">
        <SectionPrefix>//A.01 — HOW IT WORKS</SectionPrefix>
        <div className="how-grid">
          {HOW_IT_WORKS.map((item) => (
            <Panel key={item.step} className="how-card">
              <span className="how-step mono">{item.step}</span>
              <h3 className="how-title">{item.title}</h3>
              <p className="how-body">{item.body}</p>
            </Panel>
          ))}
        </div>
      </section>
    </div>
  )
}
