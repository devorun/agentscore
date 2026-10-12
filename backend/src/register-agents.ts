// Register our agents — each with its OWN key — in two places:
//   1. AgentScoreRegistry.registerAgent(name, skills, metadataURI), so explorers
//      and the registry show names instead of bare addresses;
//   2. the official ERC-8004 Identity Registry, register(agentURI), where the
//      URI is the agent card the AgentScore API serves for that agent.
// Idempotent: an agent already registered with the same profile is skipped, a
// changed profile is updated in place (registerAgent / setAgentURI).
//
//   npm run agents:register          # send
//   npm run agents:register -- --dry # report only, no transactions
import 'dotenv/config'
import { decodeEventLog, getAddress, keccak256, parseEventLogs, toHex, type Hex } from 'viem'
import { identityAbi, registryAbi } from './lib/abi.js'
import { publicClient } from './lib/chain.js'
import { EXPLORER_URL, REGISTRY_ADDRESS } from './lib/config.js'
import { AGENT_PROFILES, cardUrl, IDENTITY_REGISTRY, type AgentProfile } from './lib/erc8004.js'
import { circleAgentSigner, rawSigner, type Signer } from './lib/signer.js'

const dry = process.argv.includes('--dry')
const tx = (h: string) => `${EXPLORER_URL}/tx/${h}`

function need(name: string): `0x${string}` {
  const v = process.env[name]
  if (!v) throw new Error(`${name} missing from backend/.env`)
  return v as `0x${string}`
}

async function signerFor(p: AgentProfile): Promise<Signer> {
  const s =
    p.name === 'Lexica'
      ? rawSigner(need('AGENT_LEXICA_PRIVATE_KEY'), p.name)
      : p.name === 'Lexica Circle'
        ? await circleAgentSigner(p.name)
        : p.name === 'Prime'
          ? rawSigner(need('PRIME_AGENT_PRIVATE_KEY'), p.name)
          : rawSigner(need('BAD_AGENT_PRIVATE_KEY'), p.name)
  if (s.address !== getAddress(p.address)) throw new Error(`${p.name}: key resolves to ${s.address}, profile says ${p.address}`)
  return s
}

const sameTags = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((t, i) => t === b[i])

/** The agentId this owner holds, from the registry's Registered logs. */
async function identityOf(owner: string): Promise<bigint | undefined> {
  if ((await publicClient.readContract({ address: IDENTITY_REGISTRY, abi: identityAbi, functionName: 'balanceOf', args: [getAddress(owner)] })) === 0n) return undefined
  const res = await fetch(
    `${EXPLORER_URL}/api?module=logs&action=getLogs&address=${IDENTITY_REGISTRY}&fromBlock=0&toBlock=latest` +
      `&topic0=${keccak256(toHex('Registered(uint256,string,address)'))}&topic2=0x${'0'.repeat(24)}${owner.slice(2).toLowerCase()}&topic0_2_opr=and`,
  )
  const body = (await res.json()) as { result?: { topics: Hex[]; data: Hex }[] }
  const log = body.result?.[0]
  if (!log) throw new Error(`${owner} holds an ERC-8004 identity but its Registered log was not found`)
  const ev = decodeEventLog({ abi: identityAbi, eventName: 'Registered', topics: log.topics as [Hex, ...Hex[]], data: log.data })
  return ev.args.agentId
}

const out: Record<string, unknown>[] = []

for (const p of AGENT_PROFILES) {
  const uri = cardUrl(p.address)
  const row: Record<string, unknown> = { agent: p.name, address: getAddress(p.address), card: uri }
  const signer = dry ? undefined : await signerFor(p)

  // 1. AgentScoreRegistry
  const registered = await publicClient.readContract({ address: REGISTRY_ADDRESS, abi: registryAbi, functionName: 'isRegistered', args: [getAddress(p.address)] })
  const current = registered
    ? await publicClient.readContract({ address: REGISTRY_ADDRESS, abi: registryAbi, functionName: 'getAgent', args: [getAddress(p.address)] })
    : undefined
  if (current && current.name === p.name && current.metadataURI === uri && sameTags(current.skillTags, p.skills)) {
    row.registry = 'up to date'
  } else if (dry) {
    row.registry = registered ? 'DRY: would update profile' : 'DRY: would registerAgent'
  } else {
    const h = await signer!.writeContract({ address: REGISTRY_ADDRESS, abi: registryAbi, functionName: 'registerAgent', args: [p.name, p.skills, uri] })
    row.registry = tx(h)
  }

  // 2. ERC-8004 Identity Registry
  const agentId = await identityOf(p.address)
  if (agentId !== undefined) {
    row.erc8004Id = agentId.toString()
    const onchainUri = await publicClient.readContract({ address: IDENTITY_REGISTRY, abi: identityAbi, functionName: 'tokenURI', args: [agentId] })
    if (onchainUri === uri) row.identity = 'up to date'
    else if (dry) row.identity = `DRY: would setAgentURI (now ${onchainUri})`
    else row.identity = tx(await signer!.writeContract({ address: IDENTITY_REGISTRY, abi: identityAbi, functionName: 'setAgentURI', args: [agentId, uri] }))
  } else if (dry) {
    row.identity = 'DRY: would register'
  } else {
    const h = await signer!.writeContract({ address: IDENTITY_REGISTRY, abi: identityAbi, functionName: 'register', args: [uri] })
    const rcpt = await publicClient.getTransactionReceipt({ hash: h })
    const [ev] = parseEventLogs({ abi: identityAbi, eventName: 'Registered', logs: rcpt.logs })
    row.erc8004Id = ev?.args.agentId.toString()
    row.identity = tx(h)
  }
  out.push(row)
  console.log(JSON.stringify(row))
}

const count = await publicClient.readContract({ address: REGISTRY_ADDRESS, abi: registryAbi, functionName: 'agentCount' })
console.log(`AgentScoreRegistry.agentCount() = ${count}`)
