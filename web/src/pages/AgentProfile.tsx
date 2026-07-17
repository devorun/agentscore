import { useParams } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { ExplorerLink, MetricLabel, Panel, Pill, ScoreDial, SectionPrefix, Spinner, StatusMessage } from '../components/ui'
import { useAgentData } from '../hooks/useAgentData'
import { completionRate } from '../lib/score'
import { addressUrl, formatTimestamp, formatUsdc, shortAddress, statusPill, txUrl } from '../lib/format'
import { JobStatus } from '../lib/config'
import './agent.css'

export function AgentProfile() {
  const { address: rawAddress } = useParams()
  const { data, isLoading, isError, error, isFetching, refetch, isValidAddress, address } = useAgentData(rawAddress)
  const { address: connected } = useAccount()

  if (!isValidAddress) {
    return (
      <StatusMessage tone="negative" title="Invalid agent address">
        The address in the URL is not a valid 0x… address. Return home and paste a full agent address.
      </StatusMessage>
    )
  }

  return (
    <div className="agent">
      <header className="agent-head">
        <div>
          <SectionPrefix>//A.01 — AGENT RECORD</SectionPrefix>
          <h1 className="agent-address mono">{address}</h1>
          <div className="agent-sub">
            <ExplorerLink href={addressUrl(address as string)}>arcscan</ExplorerLink>
            {address && connected && address.toLowerCase() === connected.toLowerCase() ? (
              <span className="you-tag mono">this is you</span>
            ) : null}
          </div>
        </div>
      </header>

      {isLoading ? (
        <Panel>
          <Spinner label="indexing onchain history…" />
        </Panel>
      ) : isError ? (
        <StatusMessage
          tone="negative"
          title="Could not index this agent"
          action={
            <button className="btn btn-small" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? 'Retrying…' : 'Retry'}
            </button>
          }
        >
          {error instanceof Error ? error.message : 'The Arcscan explorer or Arc Testnet RPC did not respond.'}
        </StatusMessage>
      ) : data ? (
        <AgentBody data={data} />
      ) : null}
    </div>
  )
}

function AgentBody({ data }: { data: NonNullable<ReturnType<typeof useAgentData>['data']> }) {
  const { metrics, breakdown, jobs, profile, verdicts, truncated } = data
  const rate = completionRate(metrics)
  const disputes = metrics.rejected

  return (
    <>
      {!profile.registered ? (
        <StatusMessage tone="warning" title="Unclaimed profile">
          This address has onchain activity but no AgentScore registry profile yet. The stats below are computed
          directly from the reference contract. The owner can claim it by registering.
        </StatusMessage>
      ) : (
        <Panel className="claimed">
          <div>
            <MetricLabel>registered_name</MetricLabel>
            <div className="claimed-name">{profile.name}</div>
          </div>
          {profile.skillTags.length ? (
            <div className="tag-row">
              {profile.skillTags.map((tag) => (
                <span key={tag} className="skill-tag mono">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </Panel>
      )}

      <section className="score-block">
        <Panel className="score-panel">
          <ScoreDial score={breakdown.score} />
          <div className="score-legend">
            <MetricLabel>agentscore</MetricLabel>
            <p className="score-note">
              Base {breakdown.base} · approvals +{breakdown.approvalPoints} · rejections {breakdown.rejectionPoints} ·
              abandonment {breakdown.abandonmentPoints} · volume +{breakdown.volumeBonus.toFixed(1)}
            </p>
          </div>
        </Panel>

        <div className="metric-grid">
          <MetricTile label="completion_rate" value={rate === null ? '—' : `${Math.round(rate * 100)}%`} />
          <MetricTile label="completed_jobs" value={metrics.completed.toString()} />
          <MetricTile label="lifetime_earnings" value={formatUsdc(metrics.earnings6)} />
          <MetricTile label="job_volume" value={metrics.totalJobs.toString()} />
          <MetricTile label="disputes" value={disputes.toString()} tone={disputes > 0 ? 'danger' : 'default'} />
          <MetricTile label="settled_value" value={formatUsdc(metrics.settled6)} />
        </div>
      </section>

      <section className="agent-section">
        <SectionPrefix>//A.02 — ARBITER VERDICTS</SectionPrefix>
        {verdicts.length === 0 ? (
          <Panel>
            <p className="empty-note">
              No arbiter verdicts recorded for this agent yet. Verdicts appear here once the AgentScore arbiter settles a
              job where this agent is the provider.
            </p>
          </Panel>
        ) : (
          <ul className="verdict-list">
            {verdicts.map((v) => (
              <Panel as="li" key={`${v.jobId}-${v.attestedAt}`} className="verdict-card">
                <div className="verdict-ref mono">AGENTSCORE.ARBITER | REF-{v.reasonHash.slice(2, 10)}</div>
                <div className="verdict-row">
                  <Pill spec={v.outcome === 0 ? { label: 'APPROVED', tone: 'positive' } : { label: 'REJECTED', tone: 'negative' }} />
                  <span className="mono verdict-job">job #{v.jobId.toString()}</span>
                  <span className="verdict-time mono">{formatTimestamp(v.attestedAt)}</span>
                </div>
                <div className="verdict-hash mono">reason {v.reasonHash}</div>
              </Panel>
            ))}
          </ul>
        )}
      </section>

      <section className="agent-section">
        <SectionPrefix>//A.03 — JOB HISTORY (AS PROVIDER)</SectionPrefix>
        {truncated ? (
          <p className="truncate-note mono">showing the most recent {jobs.length} jobs</p>
        ) : null}
        {jobs.length === 0 ? (
          <Panel>
            <p className="empty-note">No jobs found where this address is the provider on the reference contract.</p>
          </Panel>
        ) : (
          <div className="table-scroll">
            <table className="job-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Status</th>
                  <th>Budget</th>
                  <th>Client</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.jobId.toString()}>
                    <td className="mono">#{job.jobId.toString()}</td>
                    <td>
                      <Pill spec={statusPill(job.status)} />
                    </td>
                    <td className="mono">{job.budget6 === 0n && job.status === JobStatus.Open ? '—' : formatUsdc(job.budget6)}</td>
                    <td className="mono">{shortAddress(job.client)}</td>
                    <td className="mono cell-muted">{job.createdAt ? formatTimestamp(job.createdAt) : '—'}</td>
                    <td>
                      <ExplorerLink href={txUrl(job.createdTx)}>tx</ExplorerLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

function MetricTile({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'danger' }) {
  return (
    <Panel className="metric-tile">
      <MetricLabel>{label}</MetricLabel>
      <div className={`metric-tile-value mono${tone === 'danger' ? ' metric-danger' : ''}`}>{value}</div>
    </Panel>
  )
}
