// Agent signer abstraction. The default "raw" path signs Arc transactions with a
// local private key via viem — exactly today's behavior. The optional "circle"
// path routes the SAME contract writes through a developer-controlled Circle Wallet
// (Circle custodies the key; we never hold it), selected by SIGNER_MODE=circle.
// Nothing here touches the always-on worker, which keeps using raw viem directly.
import { createWalletClient, encodeFunctionData, getAddress, http, type Abi, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { publicClient } from './chain.js'
import { arcTestnet, ARC_RPC } from './config.js'

export interface ContractWrite {
  address: Address
  abi: Abi
  functionName: string
  args: readonly unknown[]
}

export interface Signer {
  address: Address
  label: string
  /** Submit a contract write and resolve with the confirmed on-chain tx hash. */
  writeContract(w: ContractWrite): Promise<Hex>
}

/** Raw private-key signer (the default — unchanged behavior). */
export function rawSigner(privateKey: `0x${string}`, label: string): Signer {
  const account = privateKeyToAccount(privateKey)
  const wallet = createWalletClient({ account, chain: arcTestnet, transport: http(ARC_RPC) })
  return {
    address: getAddress(account.address),
    label,
    async writeContract(w) {
      const hash = (await wallet.writeContract({
        address: w.address,
        abi: w.abi,
        functionName: w.functionName,
        args: w.args,
        account,
        chain: arcTestnet,
      } as never)) as Hex
      await publicClient.waitForTransactionReceipt({ hash })
      return hash
    },
  }
}

/**
 * Developer-controlled Circle Wallet signer. Encodes calldata with viem, submits
 * via Circle's contract-execution API, and waits for the on-chain tx hash, then
 * confirms the receipt through our own (dRPC) client. Used only for a separate
 * "Circle-signed" agent — its own address, leaving the raw-key agent untouched.
 */
export async function circleAgentSigner(label: string): Promise<Signer> {
  const apiKey = process.env.CIRCLE_API_KEY
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET
  const walletId = process.env.CIRCLE_AGENT_WALLET_ID
  if (!apiKey || !entitySecret || !walletId) {
    throw new Error(
      'SIGNER_MODE=circle needs CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET and CIRCLE_AGENT_WALLET_ID in backend/.env (run: npm run circle:setup)',
    )
  }
  const { initiateDeveloperControlledWalletsClient } = await import('@circle-fin/developer-controlled-wallets')
  const circle = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret })

  const wres = await circle.getWallet({ id: walletId })
  const address = wres.data?.wallet?.address
  if (!address) throw new Error('could not resolve the Circle wallet address (check CIRCLE_AGENT_WALLET_ID)')

  return {
    address: getAddress(address),
    label,
    async writeContract(w) {
      const callData = encodeFunctionData({ abi: w.abi, functionName: w.functionName, args: w.args } as never) as Hex
      const created = await circle.createContractExecutionTransaction({
        walletId,
        contractAddress: w.address,
        callData,
        fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
      })
      const id = created.data?.id
      if (!id) throw new Error('Circle createContractExecutionTransaction returned no transaction id')
      // Circle broadcasts; wait until the tx hash is populated (EOA → at SENT).
      const got = await circle.getTransaction({ id, waitForTxHash: true })
      const txHash = got.data?.transaction?.txHash
      if (!txHash) throw new Error(`Circle transaction ${id} produced no txHash (state ${got.data?.transaction?.state ?? 'unknown'})`)
      await publicClient.waitForTransactionReceipt({ hash: txHash as Hex })
      return txHash as Hex
    },
  }
}

/** Choose the agent's signer by SIGNER_MODE (default = raw). */
export async function makeAgentSigner(rawKey: `0x${string}`): Promise<Signer> {
  const mode = (process.env.SIGNER_MODE || 'raw').toLowerCase()
  if (mode === 'circle') return circleAgentSigner('agent (Circle Wallet)')
  return rawSigner(rawKey, 'agent (raw key)')
}
