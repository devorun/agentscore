import 'dotenv/config'
import { serve } from '@hono/node-server'
import { app } from './app.js'
import { startWorker } from './worker.js'
import { getDeliverable, getNanopay } from './lib/store.js'
import { API_ONLY, EXPLORER_URL, NANOPAY_ENABLED, PORT } from './lib/config.js'

// The work product the agent actually produced, with the arbiter's verification
// result. Node-only (disk-backed store), so it lives here rather than in the
// serverless app.
app.get('/deliverable/:jobId', (c) => {
  const rec = getDeliverable(c.req.param('jobId'))
  if (!rec) return c.json({ error: 'no deliverable for this job' }, 404)
  const txUrl = (h?: string) => (h ? `${EXPLORER_URL}/tx/${h}` : null)
  return c.json({
    jobId: rec.jobId,
    kind: rec.kind ?? 'deterministic',
    producedBy: rec.producedBy,
    spec: rec.spec,
    inputRows: rec.inputRows,
    outputRows: rec.output.length,
    outputHash: rec.outputHash,
    memo: rec.memo ?? null,
    agentModel: rec.agentModel ?? null,
    submittedTx: txUrl(rec.submittedTx),
    verdict: rec.verdict ? { ...rec.verdict, settleTx: txUrl(rec.verdict.settleTx) } : null,
    appeal: rec.appeal ? { ...rec.appeal, attestTx: txUrl(rec.appeal.attestTx) } : null,
    output: rec.output,
  })
})

// Circle Nanopayments ledger for a job: the per-row micro-USDC rail settled over
// Circle Gateway, run alongside (never replacing) the ERC-8183 escrow. Node-only
// (disk-backed). Explicitly separates the off-chain batched rows from the on-chain
// deposit + withdraw-mint so the UI can be honest about each.
app.get('/nanopayments/:jobId', (c) => {
  const led = getNanopay(c.req.param('jobId'))
  if (!led) return c.json({ enabled: NANOPAY_ENABLED, ledger: null }, 404)
  const txUrl = (h?: string) => (h ? `${EXPLORER_URL}/tx/${h}` : null)
  return c.json({
    jobId: led.jobId,
    pricePerRowUsdc: led.pricePerRowUsdc,
    buyer: led.buyer,
    seller: led.seller,
    network: led.network,
    onchain: {
      deposit: txUrl(led.depositTx),
      withdrawMint: txUrl(led.withdrawMintTx),
      withdrawAmountUsdc: led.withdrawAmountUsdc ?? null,
    },
    offchain: {
      note: 'Each row is a gasless EIP-3009 authorization, batch-settled by Circle Gateway. Settlement ids are Gateway ledger entries, not on-chain tx hashes.',
      rowCount: led.rows.length,
      totalPaidUsdc: led.totalPaidUsdc,
      rows: led.rows,
    },
    updatedAt: led.updatedAt,
  })
})

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`AgentScore API listening on http://localhost:${info.port}`)
  console.log(`  GET /health  /agents  /agent/:address  /jobs  /arbiter/verdicts  /deliverable/:jobId  /nanopayments/:jobId`)
})

if (API_ONLY) {
  console.log('API_ONLY=1 — arbiter worker disabled (read-only).')
} else {
  startWorker().catch((e) => console.error('[worker] failed to start:', e))
}
