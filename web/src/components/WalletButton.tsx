import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { shortAddress } from '../lib/format'

export function WalletButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()

  const injectedConnector = connectors.find((c) => c.type === 'injected') ?? connectors[0]
  const hasWallet = typeof window !== 'undefined' && Boolean((window as { ethereum?: unknown }).ethereum)

  if (isConnected && address) {
    return (
      <button className="btn btn-ghost mono" onClick={() => disconnect()} title="Disconnect wallet">
        {shortAddress(address)}
      </button>
    )
  }

  if (!hasWallet) {
    return (
      <a className="btn btn-ghost" href="https://metamask.io/download/" target="_blank" rel="noreferrer noopener">
        Install a wallet
      </a>
    )
  }

  return (
    <button className="btn btn-primary" onClick={() => connect({ connector: injectedConnector })} disabled={isPending}>
      {isPending ? 'Connecting…' : 'Connect wallet'}
    </button>
  )
}
