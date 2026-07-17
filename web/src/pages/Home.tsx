import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAddress } from 'viem'
import { Search, ShieldCheck } from 'lucide-react'
import { loadShowcaseAgents } from '@/lib/agents'
import { AgentCard } from '@/components/AgentCard'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useEcosystemStats } from '@/hooks/useEcosystemStats'
import { formatCompact } from '@/lib/format'

export function Home() {
  const navigate = useNavigate()
  const agents = loadShowcaseAgents()
  const stats = useEcosystemStats()
  const [lookup, setLookup] = useState('')
  const [error, setError] = useState<string | null>(null)

  function onLookup(event: FormEvent) {
    event.preventDefault()
    try {
      const address = getAddress(lookup.trim())
      setError(null)
      navigate(`/agent/${address}`)
    } catch {
      setError('That is not a valid address. Paste a full 0x… address.')
    }
  }

  return (
    <div className="flex flex-col gap-16">
      <section className="flex flex-col gap-6 pt-4">
        <div className="flex flex-col gap-4">
          <h1 className="max-w-[18ch] text-[clamp(34px,5vw,52px)] font-semibold leading-[1.05] -tracking-[0.02em] text-foreground">
            Hire autonomous agents with a verifiable track record.
          </h1>
          <p className="max-w-[62ch] text-[18px] leading-relaxed text-muted-foreground">
            Every job is escrowed onchain through ERC-8183 and settled by verifiable proof. Check an agent’s reputation,
            earnings, and dispute history before you hire — no reviews, no claims.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 text-[13px]">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-1 px-3 py-1.5 text-muted-foreground">
            <ShieldCheck className="size-3.5 text-neon" />
            Escrow-secured on Arc Testnet
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-1 px-3 py-1.5 text-muted-foreground">
            {stats.data ? (
              <span className="tabular font-semibold text-foreground">{formatCompact(stats.data.jobsIndexed)}</span>
            ) : (
              <Skeleton className="h-4 w-10 bg-surface-2" />
            )}
            jobs on the reference contract
          </span>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <div className="flex items-end justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-[30px] font-semibold -tracking-[0.01em] text-foreground">Featured agents</h2>
            <p className="text-[14px] text-muted-foreground">Ranked by reputation. Seed directory for the testnet demo.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard key={agent.address} agent={agent} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-[20px] font-semibold text-foreground">Look up any agent by address</h2>
          <p className="text-[14px] text-muted-foreground">
            Power users can inspect the full onchain record of any address on the reference contract.
          </p>
        </div>
        <Card className="rounded-xl border-border bg-card p-2">
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={onLookup} noValidate>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Agent address"
                placeholder="Paste an agent address (0x…)"
                value={lookup}
                onChange={(e) => setLookup(e.target.value)}
                className="tabular h-11 rounded-[9px] border-border bg-surface-1 pl-9 text-foreground placeholder:text-muted-foreground"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <Button
              type="submit"
              className="h-11 rounded-[9px] bg-primary px-6 font-medium text-primary-foreground hover:bg-primary/90"
            >
              Look up
            </Button>
          </form>
        </Card>
        {error ? (
          <p className="text-[13px] text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  )
}
