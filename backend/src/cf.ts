// Cloudflare Workers entry — serves the read-only reputation API only (no
// signing worker). Requires `nodejs_compat` (see wrangler.toml) so config.ts's
// process.env access resolves from wrangler vars.
import { app } from './app.js'

export default app
