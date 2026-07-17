import { createConfig, http } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { arcTestnet, RPC_URL } from './config'

// Injected wallets only (MetaMask etc.). The app never handles keys or seed
// phrases — every transaction is signed in the user's wallet popup.
export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: http(RPC_URL),
  },
  ssr: false,
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
