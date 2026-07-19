// Circle Nanopayments rail — per-row micro-USDC settlement over Circle Gateway,
// run ALONGSIDE the ERC-8183 escrow (never replacing it). The client (buyer) signs
// gasless EIP-3009 authorizations per enriched row; Gateway verifies instantly and
// batch-settles off-chain. The only on-chain footprint is the one-time Gateway
// deposit (capitalizes the buyer's balance) and the agent's withdraw-mint (realizes
// accrued earnings). Everything here is a NO-OP unless NANOPAY_ENABLED, and it never
// touches the worker's escrow settlement path.
import { getAddress } from 'viem'
import {
  ARC_CAIP,
  ARC_RPC,
  DEMO_CLIENT_ADDRESS,
  GATEWAY_API_TESTNET,
  LIVE_AGENT_ADDRESS,
  NANOPAY_CHAIN,
  NANOPAY_ENABLED,
  NANOPAY_PORT,
  NANOPAY_PRICE_PER_ROW,
} from './config.js'
import { getNanopay, saveNanopay, type NanopayLedger } from './store.js'

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), '[nanopay]', ...a)
const nowSec = () => Math.floor(Date.now() / 1000)

export function nanopayEnabled(): boolean {
  return NANOPAY_ENABLED
}

export function isDemoClient(addr: string): boolean {
  if (!DEMO_CLIENT_ADDRESS) return false
  try {
    return getAddress(addr) === getAddress(DEMO_CLIENT_ADDRESS)
  } catch {
    return false
  }
}

// The seller endpoint (x402-protected) is started once, lazily, only when metering.
let sellerUrl: string | null = null
async function ensureSeller(): Promise<string> {
  if (sellerUrl) return sellerUrl
  // express + the batching middleware are loaded lazily so nothing heavy is pulled
  // in unless the rail is actually exercised. express ships no bundled types, so it
  // is imported via a non-literal specifier (TS treats it as `any`) — this avoids an
  // @types/express devDependency for this single optional module.
  const specifier: string = 'express'
  const express = ((await import(specifier)) as { default: () => ExpressApp }).default
  const { createGatewayMiddleware } = await import('@circle-fin/x402-batching/server')
  const app = express()
  const gateway = createGatewayMiddleware({
    sellerAddress: LIVE_AGENT_ADDRESS,
    networks: [ARC_CAIP], // Arc Testnet only
    facilitatorUrl: GATEWAY_API_TESTNET, // MUST be testnet (default is mainnet)
    description: 'AgentScore enrichment — per-row nanopayment',
  })
  app.get('/enrich-row', gateway.require(`$${NANOPAY_PRICE_PER_ROW}`), (_req: unknown, res: ExpressRes) =>
    res.json({ ok: true }),
  )
  await new Promise<void>((resolve) => app.listen(NANOPAY_PORT, () => resolve()))
  sellerUrl = `http://127.0.0.1:${NANOPAY_PORT}/enrich-row`
  log(`seller endpoint on :${NANOPAY_PORT} (recipient ${LIVE_AGENT_ADDRESS}, $${NANOPAY_PRICE_PER_ROW}/row)`)
  return sellerUrl
}

function freshLedger(jobId: string, buyer: string): NanopayLedger {
  const t = nowSec()
  return {
    jobId,
    pricePerRowUsdc: NANOPAY_PRICE_PER_ROW,
    buyer,
    seller: getAddress(LIVE_AGENT_ADDRESS),
    network: ARC_CAIP,
    rows: [],
    totalPaidUsdc: '0',
    createdAt: t,
    updatedAt: t,
  }
}

/**
 * Meter `rows` per-row micro-USDC payments (buyer = demo client, seller = agent)
 * over Circle Gateway, recording a per-job ledger for the UI. Idempotent: if the
 * job's ledger already has >= `rows` rows, it returns without re-charging.
 */
export async function meterJobRows(
  jobId: string,
  rows: number,
  opts?: { depositMode?: 'auto' | 'force' },
): Promise<NanopayLedger | undefined> {
  if (!NANOPAY_ENABLED) return
  const buyerKey = process.env.DEMO_CLIENT_PRIVATE_KEY
  if (!buyerKey) {
    log('DEMO_CLIENT_PRIVATE_KEY not set — cannot meter; skipping')
    return
  }
  if (rows <= 0) return

  const existing = getNanopay(jobId)
  if (existing && existing.rows.length >= rows) {
    log(`job #${jobId} already metered (${existing.rows.length} rows) — skipping`)
    return existing
  }

  const { GatewayClient } = await import('@circle-fin/x402-batching/client')
  const { parseUnits, formatUnits } = await import('viem')
  const url = await ensureSeller()
  const buyer = new GatewayClient({ chain: NANOPAY_CHAIN, privateKey: buyerKey as `0x${string}`, rpcUrl: ARC_RPC })

  const priceAtomic = parseUnits(NANOPAY_PRICE_PER_ROW, 6)
  const needed = priceAtomic * BigInt(rows)
  const buffer = parseUnits('0.005', 6)
  const ledger = existing ?? freshLedger(jobId, getAddress(buyer.address))

  // Fund the buyer's Gateway balance if needed (exact-amount approval, per §2.7).
  const bal = await buyer.getBalances()
  const mode = opts?.depositMode ?? 'auto'
  if (mode === 'force' || bal.gateway.available < needed + buffer) {
    const depAmt = formatUnits(needed + buffer, 6)
    log(`depositing ${depAmt} USDC into Gateway (exact approval)…`)
    const dep = await buyer.deposit(depAmt, { approveAmount: depAmt })
    ledger.depositTx = dep.depositTxHash
    ledger.updatedAt = nowSec()
    saveNanopay(ledger)
    const deadline = Date.now() + 150_000
    while (Date.now() < deadline) {
      const b = await buyer.getBalances()
      if (b.gateway.available >= needed) break
      await new Promise((r) => setTimeout(r, 6000))
    }
  }

  // Meter one gasless micro-payment per enriched row.
  let paid = 0
  for (let i = ledger.rows.length; i < rows; i++) {
    try {
      const r = await buyer.pay(url)
      ledger.rows.push({
        index: ledger.rows.length + 1,
        amountUsdc: r.formattedAmount,
        settleId: String(r.transaction),
        network: ARC_CAIP,
        at: nowSec(),
      })
      ledger.totalPaidUsdc = formatUnits(priceAtomic * BigInt(ledger.rows.length), 6)
      ledger.updatedAt = nowSec()
      saveNanopay(ledger)
      paid++
    } catch (e) {
      log(`row ${i + 1}/${rows} pay failed: ${String((e as Error).message ?? e).slice(0, 120)}`)
      break
    }
  }
  log(`metered ${paid} new row(s) for job #${jobId} — ${ledger.rows.length}/${rows} total (${ledger.totalPaidUsdc} USDC)`)
  return ledger
}

/**
 * The agent realizes accrued Gateway earnings on-chain via a same-chain instant
 * withdraw-mint. Routes the mint through dRPC (the SDK hardcodes the rate-limited
 * official Arc RPC) and recovers/verifies the tx if the SDK's receipt read flakes.
 * Records the on-chain mint tx onto the job's ledger.
 */
export async function withdrawEarnings(jobId: string, opts?: { maxUsdc?: string }): Promise<string | undefined> {
  if (!NANOPAY_ENABLED) return
  const agentKey = process.env.AGENT_LEXICA_PRIVATE_KEY
  if (!agentKey) return

  const { GatewayClient, CHAIN_CONFIGS } = await import('@circle-fin/x402-batching/client')
  const { parseUnits, formatUnits } = await import('viem')
  const { publicClient } = await import('./chain.js')

  // Route the mint + its receipt read through dRPC, not the flaky official Arc RPC.
  const cfgs = CHAIN_CONFIGS as unknown as Record<string, { rpcUrl?: string }>
  if (cfgs.arcTestnet) cfgs.arcTestnet.rpcUrl = ARC_RPC

  const agent = new GatewayClient({ chain: NANOPAY_CHAIN, privateKey: agentKey as `0x${string}`, rpcUrl: ARC_RPC })
  const bal = await agent.getBalances()
  const available = bal.gateway.available
  // Gateway charges a small transfer fee on withdrawal (balance is debited value +
  // fee), so we cannot withdraw the entire available balance — reserve a buffer.
  const feeBuffer = parseUnits('0.005', 6)
  const withdrawable = available > feeBuffer ? available - feeBuffer : 0n
  const cap = opts?.maxUsdc ? parseUnits(opts.maxUsdc, 6) : withdrawable
  const amount = withdrawable < cap ? withdrawable : cap
  if (amount < 1000n) {
    log(`nothing withdrawable yet (available ${formatUnits(available, 6)} USDC, need > 0.006 to cover fee) — batch still settling`)
    return
  }
  const amtStr = formatUnits(amount, 6)

  let mintTx: string | undefined
  try {
    const w = await agent.withdraw(amtStr) // same-chain Arc→Arc, instant mint
    mintTx = w.mintTxHash
  } catch (e) {
    // The SDK can throw on its receipt read even when the mint landed; recover the
    // hash from the error and confirm success via our own (dRPC) client.
    const m = String((e as Error).message ?? e).match(/0x[0-9a-fA-F]{64}/)
    if (!m) throw e
    const rcpt = await publicClient.getTransactionReceipt({ hash: m[0] as `0x${string}` }).catch(() => null)
    if (rcpt && rcpt.status === 'success') mintTx = m[0]
    else throw e
  }

  if (mintTx) {
    const led = getNanopay(jobId)
    if (led) {
      led.withdrawMintTx = mintTx
      led.withdrawAmountUsdc = amtStr
      led.updatedAt = nowSec()
      saveNanopay(led)
    }
    log(`withdraw-mint ${amtStr} USDC → ${mintTx}`)
  }
  return mintTx
}

// Minimal structural types for the lazily-loaded express app (avoids an
// @types/express dependency for this isolated, optional module).
type ExpressRes = { json: (body: unknown) => unknown }
interface ExpressApp {
  get: (path: string, ...handlers: unknown[]) => void
  listen: (port: number, cb: () => void) => void
}
