// One-time provisioning for the developer-controlled Circle Wallet used by the
// optional "Circle-signed" agent (Phase C). Reads CIRCLE_API_KEY from backend/.env,
// generates + registers a 32-byte entity secret, creates a wallet set and one
// ARC-TESTNET EOA wallet, and writes CIRCLE_ENTITY_SECRET / CIRCLE_WALLET_SET_ID /
// CIRCLE_AGENT_WALLET_ID back into backend/.env. Idempotent: anything already set is
// reused. SECURITY: never prints the API key, entity secret, or recovery file — only
// the new wallet's PUBLIC address. Recovery material is saved to backend/.circle/
// (gitignored). Run once:  npm run circle:setup
import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  initiateDeveloperControlledWalletsClient,
  registerEntitySecretCiphertext,
} from '@circle-fin/developer-controlled-wallets'

const ENV_PATH = fileURLToPath(new URL('../.env', import.meta.url))
const CIRCLE_DIR = fileURLToPath(new URL('../.circle', import.meta.url))

const apiKey = process.env.CIRCLE_API_KEY
if (!apiKey) {
  console.error('CIRCLE_API_KEY is not set in backend/.env — add it first.')
  process.exit(1)
}

/** Replace `KEY=...` in backend/.env (or append). Values are never logged. */
function setEnvVar(key: string, value: string): void {
  let txt = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : ''
  const re = new RegExp(`^${key}=.*$`, 'm')
  if (re.test(txt)) txt = txt.replace(re, `${key}=${value}`)
  else txt = `${txt.replace(/\s*$/, '')}\n${key}=${value}\n`
  writeFileSync(ENV_PATH, txt)
}

async function main(): Promise<void> {
  mkdirSync(CIRCLE_DIR, { recursive: true })

  // 1) Entity secret — generate + register once; reuse if already present.
  let entitySecret = process.env.CIRCLE_ENTITY_SECRET
  if (!entitySecret) {
    entitySecret = randomBytes(32).toString('hex')
    const res = await registerEntitySecretCiphertext({ apiKey: apiKey!, entitySecret, recoveryFileDownloadPath: CIRCLE_DIR })
    const recovery = res.data?.recoveryFile
    if (recovery) writeFileSync(join(CIRCLE_DIR, 'recovery_file.dat'), recovery)
    setEnvVar('CIRCLE_ENTITY_SECRET', entitySecret)
    console.log('· entity secret generated + registered with Circle → CIRCLE_ENTITY_SECRET written to backend/.env (not printed)')
    console.log('· recovery file saved under backend/.circle/ (gitignored)')
  } else {
    console.log('· CIRCLE_ENTITY_SECRET already set — reusing (registration skipped)')
  }

  const client = initiateDeveloperControlledWalletsClient({ apiKey: apiKey!, entitySecret })

  // 2) Wallet set.
  let walletSetId = process.env.CIRCLE_WALLET_SET_ID
  if (!walletSetId) {
    const ws = await client.createWalletSet({ name: 'AgentScore — Circle-signed agent' })
    walletSetId = ws.data?.walletSet?.id
    if (!walletSetId) throw new Error('createWalletSet returned no id')
    setEnvVar('CIRCLE_WALLET_SET_ID', walletSetId)
    console.log('· wallet set created → CIRCLE_WALLET_SET_ID written to backend/.env')
  } else {
    console.log('· CIRCLE_WALLET_SET_ID already set — reusing')
  }

  // 3) One ARC-TESTNET EOA wallet.
  let walletId = process.env.CIRCLE_AGENT_WALLET_ID
  let address: string | undefined
  if (!walletId) {
    const w = await client.createWallets({ blockchains: ['ARC-TESTNET'], accountType: 'EOA', count: 1, walletSetId })
    const wallet = w.data?.wallets?.[0]
    walletId = wallet?.id
    address = wallet?.address
    if (!walletId || !address) throw new Error('createWallets returned no id/address')
    setEnvVar('CIRCLE_AGENT_WALLET_ID', walletId)
    console.log('· ARC-TESTNET EOA wallet created → CIRCLE_AGENT_WALLET_ID written to backend/.env')
  } else {
    console.log('· CIRCLE_AGENT_WALLET_ID already set — reusing')
    try {
      const w = await client.getWallet({ id: walletId })
      address = w.data?.wallet?.address
    } catch {
      /* fetch is best-effort; the id is already in .env */
    }
  }

  console.log('\n=== Circle-signed agent — PUBLIC address (fund this on the faucet) ===')
  console.log(address ?? '(already provisioned; address not re-fetched)')
}

main().catch((e) => {
  console.error('circle-setup error:', (e as Error).message ?? e)
  process.exit(1)
})
