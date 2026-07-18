import 'dotenv/config'
import { serve } from '@hono/node-server'
import { app } from './app.js'
import { startWorker } from './worker.js'
import { getDeliverable } from './lib/store.js'
import { API_ONLY, EXPLORER_URL, PORT } from './lib/config.js'

// The work product the agent actually produced, with the arbiter's verification
// result. Node-only (disk-backed store), so it lives here rather than in the
// serverless app.
app.get('/deliverable/:jobId', (c) => {
  const rec = getDeliverable(c.req.param('jobId'))
  if (!rec) return c.json({ error: 'no deliverable for this job' }, 404)
  const txUrl = (h?: string) => (h ? `${EXPLORER_URL}/tx/${h}` : null)
  return c.json({
    jobId: rec.jobId,
    producedBy: rec.producedBy,
    spec: rec.spec,
    inputRows: rec.inputRows,
    outputRows: rec.output.length,
    outputHash: rec.outputHash,
    submittedTx: txUrl(rec.submittedTx),
    verdict: rec.verdict ? { ...rec.verdict, settleTx: txUrl(rec.verdict.settleTx) } : null,
    output: rec.output,
  })
})

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`AgentScore API listening on http://localhost:${info.port}`)
  console.log(`  GET /health  /agents  /agent/:address  /jobs  /arbiter/verdicts  /deliverable/:jobId`)
})

if (API_ONLY) {
  console.log('API_ONLY=1 — arbiter worker disabled (read-only).')
} else {
  startWorker().catch((e) => console.error('[worker] failed to start:', e))
}
