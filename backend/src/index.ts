import 'dotenv/config'
import { serve } from '@hono/node-server'
import { app } from './app.js'
import { startWorker } from './worker.js'
import { API_ONLY, PORT } from './lib/config.js'

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`AgentScore API listening on http://localhost:${info.port}`)
  console.log(`  GET /health  /agents  /agent/:address  /jobs  /arbiter/verdicts`)
})

if (API_ONLY) {
  console.log('API_ONLY=1 — arbiter worker disabled (read-only).')
} else {
  startWorker().catch((e) => console.error('[worker] failed to start:', e))
}
