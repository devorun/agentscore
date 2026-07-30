import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAccount, useBalance, useChainId, useConnect, useReadContract, useWriteContract } from 'wagmi'
import { readContract, waitForTransactionReceipt } from '@wagmi/core'
import { parseEventLogs, parseUnits, zeroAddress } from 'viem'
import { toast } from 'sonner'
import { AlertTriangle, ArrowUpRight, Check, Loader2, ShieldCheck, Wallet } from 'lucide-react'
import { findShowcaseAgent, isHireable } from '@/lib/agents'
import { useAgentData } from '@/hooks/useAgentData'
import { creditTerms, type CreditTerms } from '@/lib/credit'
import { erc8183Abi, usdcAbi } from '@/lib/abi'
import { wagmiConfig } from '@/lib/wagmi'
import { ARBITER_ADDRESS, arcTestnet, ERC8183_ADDRESS, FAUCET_URL, USDC_ADDRESS, USDC_DECIMALS } from '@/lib/config'
import { addressUrl, formatUsdc, shortAddress, txUrl } from '@/lib/format'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// Markers the protocol reserves in a job's onchain description. A visitor who
// typed one would create a job the live cloud worker deliberately skips (or
// mis-routes), leaving their escrow locked until the expiry refund — so the
// hire input strips them before the job is created, and says so.
const RESERVED_MARKERS = /\[\s*(JUDGED|LAZY|BAD|TERMS\b[^\]]*|COLLATERAL\b[^\]]*|SUBCONTRACT\b[^\]]*)\s*\]/gi

export function stripReservedMarkers(text: string): { clean: string; found: string[] } {
  const found = Array.from(text.matchAll(RESERVED_MARKERS)).map((m) => m[0])
  const clean = text.replace(RESERVED_MARKERS, ' ').replace(/\s{2,}/g, ' ').trim()
  return { clean, found }
}

type Step = 'advance' | 'create' | 'budget' | 'approve' | 'fund' | 'done'
const STEP_ORDER: Step[] = ['create', 'budget', 'approve', 'fund']
const STEP_LABEL: Record<Step, string> = {
  advance: 'Pay the advance directly to the agent',
  create: 'Create the job onchain',
  budget: 'Agent confirms the price',
  approve: 'Approve the exact USDC amount',
  fund: 'Fund the escrow',
  done: 'Funded',
}

function ExplorerLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-0.5 text-neon transition-colors hover:opacity-80"
    >
      {children}
      <ArrowUpRight className="size-3" />
    </a>
  )
}

export function HirePage() {
  const { address: rawAddress } = useParams()
  const agent = rawAddress ? findShowcaseAgent(rawAddress) : undefined

  if (!agent || !isHireable(agent)) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4 py-6">
        <h1 className="text-[26px] font-semibold text-foreground">
          {agent ? `${agent.name} is not hireable yet` : 'Agent not found'}
        </h1>
        <Card className="rounded-xl border-warning/30 bg-warning/5 p-6">
          <p className="text-[15px] leading-relaxed text-foreground">
            {agent
              ? `${agent.name} is a demo profile — not yet registered onchain. Only agents registered on Arc Testnet can take a funded job, so the escrow flow stays closed until then.`
              : 'This address is not a registered AgentScore agent.'}
          </p>
        </Card>
        <Link to="/" className="text-[14px] text-neon hover:opacity-80">
          ← Back to the showcase
        </Link>
      </div>
    )
  }

  return <HireFlow agent={agent} />
}

function HireFlow({ agent }: { agent: NonNullable<ReturnType<typeof findShowcaseAgent>> }) {
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const chainId = useChainId()
  const onArc = chainId === arcTestnet.id

  const budget6 = useMemo(() => parseUnits(String(agent.pricePerJobUsdc), USDC_DECIMALS), [agent.pricePerJobUsdc])
  const [description, setDescription] = useState('Translate a product landing page into French, German, and Japanese.')
  // Defuse the reserved-marker trap: a visitor who types [JUDGED], [TERMS …] or
  // [COLLATERAL] would create a job the settlement worker skips or gates on,
  // stranding their escrow until expiry. Strip them from what goes onchain, and
  // tell the visitor exactly what was removed.
  const reserved = useMemo(() => stripReservedMarkers(description), [description])
  const [step, setStep] = useState<Step>('create')
  const [jobId, setJobId] = useState<bigint | undefined>()
  const [busy, setBusy] = useState(false)
  const [advanceTx, setAdvanceTx] = useState<`0x${string}` | undefined>()

  // Credit terms follow the agent's LIVE score at hire time.
  const agentData = useAgentData(agent.address)
  const liveScore = agentData.data?.breakdown.score
  const terms = liveScore === undefined ? undefined : creditTerms(liveScore)
  const advance6 = terms?.tier === 'credit' ? (budget6 * BigInt(terms.advancePct)) / 100n : 0n
  const escrow6 = budget6 - advance6

  // Credit tier starts with the advance step (working capital before work).
  useEffect(() => {
    if (terms?.tier === 'credit' && step === 'create' && !advanceTx) setStep('advance')
  }, [terms?.tier, step, advanceTx])

  const { data: platformFeeBP } = useReadContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'platformFeeBP' })
  const { data: evaluatorFeeBP } = useReadContract({ address: ERC8183_ADDRESS, abi: erc8183Abi, functionName: 'evaluatorFeeBP' })
  const { data: usdcBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: usdcAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  })
  const { data: gas } = useBalance({ address })
  const { writeContractAsync } = useWriteContract()

  const feesLoaded = platformFeeBP !== undefined && evaluatorFeeBP !== undefined
  // Fees apply to the escrowed amount (what the reference contract sees).
  const platformFee6 = feesLoaded ? (escrow6 * (platformFeeBP as bigint)) / 10000n : 0n
  const evaluatorFee6 = feesLoaded ? (escrow6 * (evaluatorFeeBP as bigint)) / 10000n : 0n
  const providerGets6 = escrow6 - platformFee6 - evaluatorFee6

  const insufficientUsdc = usdcBalance !== undefined && (usdcBalance as bigint) < budget6
  const insufficientGas = gas !== undefined && gas.value === 0n

  // Poll for the provider's setBudget after the job is created.
  useEffect(() => {
    if (step !== 'budget' || jobId === undefined) return
    let active = true
    const tick = async () => {
      try {
        const has = await readContract(wagmiConfig, {
          address: ERC8183_ADDRESS,
          abi: erc8183Abi,
          functionName: 'jobHasBudget',
          args: [jobId],
        })
        if (active && has) setStep('approve')
      } catch {
        /* transient */
      }
    }
    const id = setInterval(tick, 4000)
    void tick()
    return () => {
      active = false
      clearInterval(id)
    }
  }, [step, jobId])

  // Track how long we've sat at the pricing step, so the UI can stop implying
  // "any second now" and give honest status if the worker is briefly behind —
  // a visitor must never be left guessing at a spinner.
  const [budgetSince, setBudgetSince] = useState<number | undefined>()
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (step !== 'budget') {
      setBudgetSince(undefined)
      return
    }
    setBudgetSince((prev) => prev ?? Date.now())
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [step])
  const pricingElapsedSec = step === 'budget' && budgetSince ? Math.max(0, Math.floor((nowMs - budgetSince) / 1000)) : 0

  async function onAdvance() {
    setBusy(true)
    try {
      const hash = await writeContractAsync({
        address: USDC_ADDRESS,
        abi: usdcAbi,
        functionName: 'transfer',
        args: [agent.address, advance6],
      })
      await waitForTransactionReceipt(wagmiConfig, { hash })
      setAdvanceTx(hash)
      setStep('create')
      toast.success('Advance paid directly to the agent.', {
        description: `${formatUsdc(advance6)} working capital, before any work.`,
        action: { label: 'Arcscan', onClick: () => window.open(txUrl(hash), '_blank') },
      })
    } catch (err) {
      toast.error('Transaction failed. Nothing was charged beyond gas.', {
        description: err instanceof Error ? err.message.slice(0, 140) : undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  async function onCreate() {
    setBusy(true)
    try {
      const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600)
      // Strip any reserved markers from the visitor's text first; the app then
      // appends its own [TERMS …] for credit hires, so only our marker survives.
      const clean = stripReservedMarkers(description).clean
      const finalDescription =
        terms?.tier === 'credit' && advanceTx
          ? `${clean} [TERMS tier=credit score=${liveScore} advance=${advanceTx}]`
          : clean
      const hash = await writeContractAsync({
        address: ERC8183_ADDRESS,
        abi: erc8183Abi,
        functionName: 'createJob',
        args: [agent.address, ARBITER_ADDRESS, expiredAt, finalDescription, zeroAddress],
      })
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash })
      const logs = parseEventLogs({ abi: erc8183Abi, eventName: 'JobCreated', logs: receipt.logs })
      const created = logs[0] as { args: { jobId: bigint } } | undefined
      if (!created) throw new Error('Job created but the JobCreated event was not found.')
      setJobId(created.args.jobId)
      setStep('budget')
      toast.success('Job created onchain.', {
        description: `Job #${created.args.jobId.toString()}`,
        action: { label: 'Arcscan', onClick: () => window.open(txUrl(hash), '_blank') },
      })
    } catch (err) {
      toast.error('Transaction failed. Nothing was charged beyond gas.', {
        description: err instanceof Error ? err.message.slice(0, 140) : undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  async function onApprove() {
    if (jobId === undefined) return
    setBusy(true)
    try {
      const onchainBudget = (await readContract(wagmiConfig, {
        address: ERC8183_ADDRESS,
        abi: erc8183Abi,
        functionName: 'getJob',
        args: [jobId],
      })) as { budget: bigint }
      // Exact-amount approval only — never unlimited.
      const hash = await writeContractAsync({
        address: USDC_ADDRESS,
        abi: usdcAbi,
        functionName: 'approve',
        args: [ERC8183_ADDRESS, onchainBudget.budget],
      })
      await waitForTransactionReceipt(wagmiConfig, { hash })
      setStep('fund')
      toast.success('Approved exact amount.', {
        action: { label: 'Arcscan', onClick: () => window.open(txUrl(hash), '_blank') },
      })
    } catch (err) {
      toast.error('Transaction failed. Nothing was charged beyond gas.', {
        description: err instanceof Error ? err.message.slice(0, 140) : undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  async function onFund() {
    if (jobId === undefined) return
    setBusy(true)
    try {
      const hash = await writeContractAsync({
        address: ERC8183_ADDRESS,
        abi: erc8183Abi,
        functionName: 'fund',
        args: [jobId, '0x'],
      })
      await waitForTransactionReceipt(wagmiConfig, { hash })
      setStep('done')
      toast.success('Settled onchain.', {
        description: `Escrow funded for job #${jobId.toString()}.`,
        action: { label: 'Arcscan', onClick: () => window.open(txUrl(hash), '_blank') },
      })
    } catch (err) {
      toast.error('Transaction failed. Nothing was charged beyond gas.', {
        description: err instanceof Error ? err.message.slice(0, 140) : undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 py-2">
      <div className="flex items-center gap-3">
        <div
          className="flex size-12 items-center justify-center rounded-[12px] text-[20px] font-semibold"
          style={{ backgroundColor: `${agent.accent}22`, color: agent.accent }}
          aria-hidden="true"
        >
          {agent.name.charAt(0)}
        </div>
        <div>
          <h1 className="text-[26px] font-semibold -tracking-[0.01em] text-foreground">Hire {agent.name}</h1>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {agent.skills.map((s) => (
              <Badge key={s} variant="secondary" className="rounded-md bg-surface-2 text-[12px] font-normal text-cream">
                {s}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {terms ? <TermsCard terms={terms} /> : null}

      {/* Escrow preview — shown before any signature */}
      <Card className="flex flex-col gap-3 rounded-xl border-border bg-card p-5">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Escrow summary</h2>
        {terms?.tier === 'credit' ? (
          <Row label={`Advance (${terms.advancePct}%, paid directly upfront)`} value={<span className="tabular font-semibold text-foreground">{formatUsdc(advance6)}</span>} />
        ) : null}
        <Row label="You pay (escrow)" value={<span className="tabular font-semibold text-foreground">{formatUsdc(escrow6)}</span>} />
        <Row label="Recipient (provider)" value={<ExplorerLink href={addressUrl(agent.address)}>{shortAddress(agent.address)}</ExplorerLink>} />
        <Row label="Evaluator (arbiter)" value={<ExplorerLink href={addressUrl(ARBITER_ADDRESS)}>{shortAddress(ARBITER_ADDRESS)}</ExplorerLink>} />
        <Row
          label="Platform fee"
          value={feesLoaded ? <span className="tabular text-foreground">{Number(platformFeeBP) / 100}% · {formatUsdc(platformFee6)}</span> : <Skeleton className="h-4 w-20 bg-surface-2" />}
        />
        <Row
          label="Evaluator fee"
          value={feesLoaded ? <span className="tabular text-foreground">{Number(evaluatorFeeBP) / 100}% · {formatUsdc(evaluatorFee6)}</span> : <Skeleton className="h-4 w-20 bg-surface-2" />}
        />
        <div className="my-1 h-px bg-border" />
        <Row
          label="Provider receives on completion"
          value={feesLoaded ? <span className="tabular font-semibold text-foreground">{formatUsdc(providerGets6)}</span> : <Skeleton className="h-4 w-24 bg-surface-2" />}
        />
        <p className="flex items-start gap-2 pt-1 text-[12px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-neon" />
          Approval is for this exact amount only, never unlimited. Escrow is held by the ERC-8183 reference contract on
          Arc Testnet — AgentScore never holds your funds.
        </p>
      </Card>

      <div className="flex flex-col gap-2">
        <label htmlFor="job-desc" className="text-[13px] font-medium text-foreground">
          What are you hiring for?
        </label>
        <Input
          id="job-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="h-11 rounded-[9px] border-border bg-surface-1 text-foreground"
        />
        {reserved.found.length > 0 ? (
          <p className="flex items-start gap-2 text-[12px] leading-relaxed text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Reserved protocol {reserved.found.length === 1 ? 'marker' : 'markers'}{' '}
              <span className="font-medium text-foreground">{reserved.found.join(' ')}</span> will be removed. These
              route or gate jobs on the settlement worker — left in your description, they would strand your escrow until
              the job expired. The job is created without them.
            </span>
          </p>
        ) : null}
      </div>

      {/* Steps */}
      <Card className="flex flex-col gap-3 rounded-xl border-border bg-card p-5">
        {(terms?.tier === 'credit' ? (['advance', ...STEP_ORDER] as Step[]) : STEP_ORDER).map((s, i, order) => {
          const idx = order.indexOf(step === 'done' ? 'fund' : step)
          const done = step === 'done' ? true : i < idx
          const active = step !== 'done' && i === idx
          return (
            <div key={s} className="flex items-center gap-3">
              <span
                className={cn(
                  'flex size-6 items-center justify-center rounded-full border text-[12px] tabular',
                  done
                    ? 'border-success/40 bg-success/15 text-success'
                    : active
                      ? 'border-neon/40 bg-neon/15 text-neon'
                      : 'border-border text-muted-foreground',
                )}
              >
                {done ? <Check className="size-3.5" /> : active && busy ? <Loader2 className="size-3.5 animate-spin" /> : i + 1}
              </span>
              <span className={cn('text-[14px]', active || done ? 'text-foreground' : 'text-muted-foreground')}>
                {STEP_LABEL[s]}
              </span>
            </div>
          )
        })}
      </Card>

      {/* Action zone with all wallet/balance states */}
      <ActionZone
        isConnected={isConnected}
        onArc={onArc}
        insufficientUsdc={insufficientUsdc}
        insufficientGas={insufficientGas}
        budget6={budget6}
        escrow6={escrow6}
        advance6={advance6}
        step={step}
        busy={busy}
        pricingElapsedSec={pricingElapsedSec}
        jobId={jobId}
        onConnect={() => connect({ connector: connectors[0] })}
        onAdvance={onAdvance}
        onCreate={onCreate}
        onApprove={onApprove}
        onFund={onFund}
      />

      {jobId !== undefined ? (
        <Link to={`/job/${jobId}`} className="text-center text-[14px] text-neon hover:opacity-80">
          Watch the autonomous loop live on the job page →
        </Link>
      ) : null}
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-[14px]">
      <span className="text-muted-foreground">{label}</span>
      {value}
    </div>
  )
}

const TIER_STYLE: Record<CreditTerms['tier'], string> = {
  credit: 'border-success/30 bg-success/10 text-success',
  standard: 'border-neon/30 bg-neon/10 text-neon',
  collateral: 'border-warning/30 bg-warning/10 text-warning',
}

// The hired agent's live credit terms — reputation with economic consequence.
function TermsCard({ terms }: { terms: CreditTerms }) {
  return (
    <Card className="flex flex-col gap-2 rounded-xl border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Credit terms</h2>
        <Badge variant="outline" className={cn('rounded-md text-[11px] font-medium uppercase tracking-wide', TIER_STYLE[terms.tier])}>
          {terms.headline}
        </Badge>
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">{terms.detail}</p>
      {terms.tier === 'collateral' ? (
        <p className="text-[12px] leading-relaxed text-warning">
          Collateral is agent-posted (a mirror job it must fund), so this manual hire proceeds as standard escrow — your
          escrow stays refund-protected by the arbiter either way. The guided collateral flow runs in the orchestrated
          agent-to-agent hiring.
        </p>
      ) : null}
      <p className="text-[12px] leading-relaxed text-muted-foreground/80">
        Terms are enforced by orchestration and self-interest, not chain law — the same way ignoring a credit bureau is
        possible but expensive.
      </p>
    </Card>
  )
}

function ActionZone(props: {
  isConnected: boolean
  onArc: boolean
  insufficientUsdc: boolean
  insufficientGas: boolean
  budget6: bigint
  escrow6: bigint
  advance6: bigint
  step: Step
  busy: boolean
  pricingElapsedSec: number
  jobId?: bigint
  onConnect: () => void
  onAdvance: () => void
  onCreate: () => void
  onApprove: () => void
  onFund: () => void
}) {
  const { isConnected, onArc, insufficientUsdc, insufficientGas, budget6, escrow6, advance6, step, busy, pricingElapsedSec, jobId } = props
  const primary = 'h-11 w-full rounded-[9px] bg-primary font-medium text-primary-foreground hover:bg-[var(--primary-hover)]'

  if (!isConnected) {
    return (
      <Button className={primary} onClick={props.onConnect}>
        <Wallet className="size-4" />
        Connect wallet to hire
      </Button>
    )
  }
  if (!onArc) {
    return <p className="text-center text-[14px] text-warning">Switch to Arc Testnet to continue.</p>
  }
  if (insufficientGas) {
    return (
      <Card className="flex flex-col items-start gap-2 rounded-xl border-warning/30 bg-warning/5 p-4">
        <p className="text-[14px] text-foreground">You need testnet USDC for gas. Get it free from the Circle faucet.</p>
        <a href={FAUCET_URL} target="_blank" rel="noreferrer noopener" className="text-[13px] text-neon hover:opacity-80">
          Open faucet ↗
        </a>
      </Card>
    )
  }
  if (step === 'advance') {
    return (
      <div className="flex flex-col gap-2">
        {insufficientUsdc ? (
          <p className="text-[13px] text-warning">Your USDC balance is below {formatUsdc(budget6)} (advance + escrow).</p>
        ) : null}
        <Button className={primary} onClick={props.onAdvance} disabled={busy || insufficientUsdc}>
          {busy ? 'Paying advance…' : `Pay ${formatUsdc(advance6)} advance directly to the agent`}
        </Button>
      </div>
    )
  }
  if (step === 'create') {
    return (
      <div className="flex flex-col gap-2">
        {insufficientUsdc ? (
          <p className="text-[13px] text-warning">
            Your USDC balance is below {formatUsdc(budget6)}. You can create the job now and fund once topped up.
          </p>
        ) : null}
        <Button className={primary} onClick={props.onCreate} disabled={busy}>
          {busy ? 'Creating job…' : 'Create job'}
        </Button>
      </div>
    )
  }
  if (step === 'budget') {
    // Up to ~2.5 min: normal wait (one cron tick ≈ a minute). Past that, stop
    // spinning silently and tell the visitor the honest truth.
    if (pricingElapsedSec < 150) {
      return (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface-1 p-4 text-[14px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-neon" />
          Waiting for the agent to price the job onchain — the autonomous worker runs about once a minute
          {pricingElapsedSec > 0 ? ` (${pricingElapsedSec}s)` : ''}.
        </div>
      )
    }
    return (
      <Card className="flex flex-col gap-2 rounded-xl border-warning/30 bg-warning/5 p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0 text-warning" />
          <span className="text-[14px] font-medium text-foreground">Pricing is taking longer than usual</span>
        </div>
        <p className="max-w-[70ch] text-[13px] leading-relaxed text-muted-foreground">
          {jobId !== undefined ? (
            <>
              Your job <span className="text-foreground">#{jobId.toString()}</span> is already onchain and{' '}
            </>
          ) : (
            'Your job is already onchain and '
          )}
          <span className="text-foreground">unfunded — nothing is at risk and no USDC is committed yet.</span> The
          autonomous settlement worker prices new jobs about once a minute; occasionally it runs a little behind. You can
          safely leave this page and come back — pricing still applies when it lands — or start a fresh hire.
        </p>
        {jobId !== undefined ? (
          <Link to={`/job/${jobId.toString()}`} className="text-[13px] text-neon hover:opacity-80">
            View job #{jobId.toString()} →
          </Link>
        ) : null}
      </Card>
    )
  }
  if (step === 'approve') {
    return (
      <Button className={primary} onClick={props.onApprove} disabled={busy || insufficientUsdc}>
        {busy ? 'Approving…' : `Approve exactly ${formatUsdc(escrow6)}`}
      </Button>
    )
  }
  if (step === 'fund') {
    return (
      <Button className={primary} onClick={props.onFund} disabled={busy}>
        {busy ? 'Funding escrow…' : 'Fund escrow'}
      </Button>
    )
  }
  return (
    <Card className="flex items-center gap-2 rounded-xl border-success/30 bg-success/5 p-4 text-[14px] text-foreground">
      <Check className="size-4 text-success" />
      Settled onchain. Escrow is funded and held by the reference contract.
    </Card>
  )
}
