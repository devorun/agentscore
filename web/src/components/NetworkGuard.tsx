import { useAccount, useSwitchChain } from 'wagmi'
import { arcTestnet } from '../lib/config'

// Wrong-network banner (§7 copy deck, verbatim). Injected wallets get an
// add/switch prompt with the exact Arc Testnet params.
export function NetworkGuard() {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending } = useSwitchChain()

  if (!isConnected || chainId === arcTestnet.id) return null

  return (
    <div className="network-banner" role="alert">
      <span>This app runs on Arc Testnet. Switch network to continue.</span>
      <button className="btn btn-small" onClick={() => switchChain({ chainId: arcTestnet.id })} disabled={isPending}>
        {isPending ? 'Switching…' : 'Switch to Arc Testnet'}
      </button>
    </div>
  )
}
