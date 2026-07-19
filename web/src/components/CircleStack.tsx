import { ArrowUpRight } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { addressUrl, txUrl } from '@/lib/format'
import { ERC8183_ADDRESS } from '@/lib/config'
import { cn } from '@/lib/utils'

// Judge-facing map of the Circle developer tools AgentScore uses: what each is,
// where it lives in the code, why we use it, and a live Arc Testnet proof link.
// Every proof below is a real, verifiable onchain transaction or address.

const REGISTRY = '0x1489b56AaE4BB63e9793a151C12964B19bC99d38'
const NANOPAY_DEPOSIT = '0xdb66f74f29cabe68ad0c51f7b7971411e8554763cc8795eae7e6f23b024de8e4'
const NANOPAY_WITHDRAW = '0x49390833e216c43b3568e51f5aa686498d66a1546d8b2a5108c2c6f14d47429b'
const SETTLE_TX = '0x7818106dd2afbd751c64b41767d0474633fd0b7282510eb93781836de03bc4a4'
const REJECT_TX = '0x87c9026db8451c3a73b471aa10dca17a6bf44f566cfe0f319da711b8d9f5a806'
// Circle-signed job #158772: the developer-controlled wallet signed setBudget + submit.
const WALLETS_SETBUDGET = '0x09441c23a7035ba126a98aac1dfc6a2467a091c3eb47c5d62be3ef0691ff733e'
const WALLETS_SUBMIT = '0xa4d5cbb5da0107531ca434c3de273fd3658866ba8897a7aebb89de3e5e6c6deb'
const WALLETS_COMPLETE = '0xd6bba064caee91bc50015afa7f59e6d4a4669ce0d9a55c7f452b7bf25be939b6'

type Status = 'live' | 'in-progress' | 'not-used'
interface Proof {
  label: string
  href: string
}
interface Tool {
  name: string
  status: Status
  what: string
  where: string
  why: string
  proofs: Proof[]
}

const TOOLS: Tool[] = [
  {
    name: 'Contracts',
    status: 'live',
    what: 'Our data-only AgentScoreRegistry stores agent profiles and arbiter verdict attestations; escrow lives in the official ERC-8183 AgenticCommerce reference contract. Our contracts hold no funds.',
    where: 'contracts/src/AgentScoreRegistry.sol · backend/src/worker.ts',
    why: 'Reputation and verdicts are verifiable onchain; escrow is the settlement of record.',
    proofs: [
      { label: 'Registry', href: addressUrl(REGISTRY) },
      { label: 'ERC-8183 reference', href: addressUrl(ERC8183_ADDRESS) },
      { label: 'Settled job', href: txUrl(SETTLE_TX) },
      { label: 'Rejected + refunded', href: txUrl(REJECT_TX) },
    ],
  },
  {
    name: 'Nanopayments',
    status: 'live',
    what: 'The enrichment agent is paid per row in micro-USDC over the x402 protocol (gasless EIP-3009 authorizations), running alongside — never replacing — the escrow. Each row is off-chain and batch-settled; the only onchain footprint is the one-time Gateway deposit and the agent’s withdraw-mint.',
    where: 'backend/src/lib/nanopay.ts · web/src/pages/JobDetail.tsx',
    why: 'Machine-to-machine, per-action settlement — sub-cent payments that a per-tx gas model can’t support.',
    proofs: [
      { label: 'Gateway deposit', href: txUrl(NANOPAY_DEPOSIT) },
      { label: 'Withdraw-mint', href: txUrl(NANOPAY_WITHDRAW) },
    ],
  },
  {
    name: 'Gateway',
    status: 'live',
    what: 'Circle Gateway is the settlement engine under nanopayments: deposit USDC once, sign off-chain authorizations, and Gateway batch-settles net positions. Same-chain withdrawals mint back on Arc instantly.',
    where: 'backend/src/lib/nanopay.ts (GatewayClient deposit / withdraw)',
    why: 'Turns thousands of sub-cent authorizations into a single onchain settlement — the economics that make nanopayments real.',
    proofs: [
      { label: 'Deposit onchain', href: txUrl(NANOPAY_DEPOSIT) },
      { label: 'Withdraw-mint onchain', href: txUrl(NANOPAY_WITHDRAW) },
    ],
  },
  {
    name: 'Wallets (developer-controlled)',
    status: 'live',
    what: 'A developer-controlled Circle Wallet signs as a separate “Circle-signed” agent with its own address (selected by SIGNER_MODE). It signed setBudget + submit for a real job, which the raw-key arbiter verified and settled — the proven raw-key agent (0x939A…) and all existing proofs stay untouched.',
    where: 'backend/src/lib/signer.ts · backend/src/circle-setup.ts · backend/src/demo-circle.ts',
    why: 'Sign real Arc transactions through Circle’s custodied API — no raw private key in the loop.',
    proofs: [
      { label: 'setBudget (Circle-signed)', href: txUrl(WALLETS_SETBUDGET) },
      { label: 'submit (Circle-signed)', href: txUrl(WALLETS_SUBMIT) },
      { label: 'arbiter settled', href: txUrl(WALLETS_COMPLETE) },
    ],
  },
  {
    name: 'Paymaster',
    status: 'not-used',
    what: 'Circle Paymaster lets users pay gas in USDC instead of a native token. On Arc, USDC already IS the native gas token, so there is nothing to abstract — and Arc is not on Circle Paymaster’s supported-chain list.',
    where: '—',
    why: 'Deliberately skipped: redundant on Arc. Documented so the choice is a considered one, not an omission.',
    proofs: [],
  },
]

const STATUS_STYLE: Record<Status, { label: string; cls: string }> = {
  live: { label: 'Live on Arc Testnet', cls: 'border-success/30 bg-success/10 text-success' },
  'in-progress': { label: 'In progress', cls: 'border-warning/30 bg-warning/10 text-warning' },
  'not-used': { label: 'Not used — by design', cls: 'border-border bg-surface-2 text-muted-foreground' },
}

function ProofLink({ proof }: { proof: Proof }) {
  return (
    <a
      href={proof.href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-0.5 rounded-md border border-neon/30 bg-neon/10 px-2 py-0.5 text-[12px] text-neon transition-colors hover:bg-neon/15"
    >
      {proof.label}
      <ArrowUpRight className="size-3" />
    </a>
  )
}

export function CircleStack() {
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-[30px] font-semibold -tracking-[0.01em] text-foreground">Circle stack</h2>
        <p className="max-w-[70ch] text-[14px] text-muted-foreground">
          Which Circle developer tools power AgentScore, where they live in the code, and a live Arc Testnet proof for
          each. Every link is a real onchain transaction or address — nothing simulated.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {TOOLS.map((t) => {
          const s = STATUS_STYLE[t.status]
          return (
            <Card key={t.name} className="flex flex-col gap-3 rounded-xl border-border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[16px] font-semibold text-foreground">{t.name}</h3>
                <span className={cn('rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide', s.cls)}>
                  {s.label}
                </span>
              </div>
              <p className="text-[13px] leading-relaxed text-muted-foreground">{t.what}</p>
              <div className="flex flex-col gap-1 text-[13px]">
                <div className="flex gap-2">
                  <span className="shrink-0 text-muted-foreground/70">In code</span>
                  <span className="text-cream">{t.where}</span>
                </div>
                <div className="flex gap-2">
                  <span className="shrink-0 text-muted-foreground/70">Why</span>
                  <span className="text-muted-foreground">{t.why}</span>
                </div>
              </div>
              {t.proofs.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {t.proofs.map((p) => (
                    <ProofLink key={p.label} proof={p} />
                  ))}
                </div>
              ) : null}
            </Card>
          )
        })}
      </div>
    </section>
  )
}
