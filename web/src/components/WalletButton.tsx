import { useAccount, useBalance, useConnect, useDisconnect } from 'wagmi'
import { ChevronDown, LogOut, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { shortAddress } from '@/lib/format'

const WALLET_INSTALL_URL = 'https://metamask.io/download/'

export function WalletButton() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const { data: balance } = useBalance({ address })

  if (!isConnected || !address) {
    const injectedConnector = connectors.find((c) => c.type === 'injected') ?? connectors[0]
    const hasInjected = typeof window !== 'undefined' && Boolean((window as { ethereum?: unknown }).ethereum)
    if (!hasInjected) {
      return (
        <Button
          asChild
          variant="outline"
          className="h-9 rounded-[9px] border-border bg-transparent text-foreground hover:bg-surface-2"
        >
          <a href={WALLET_INSTALL_URL} target="_blank" rel="noreferrer noopener">
            <Wallet className="size-4" />
            Install a wallet
          </a>
        </Button>
      )
    }
    return (
      <Button
        className="h-9 rounded-[9px] bg-primary font-medium text-primary-foreground hover:bg-primary/90"
        disabled={isPending}
        onClick={() => connect({ connector: injectedConnector })}
      >
        <Wallet className="size-4" />
        {isPending ? 'Connecting…' : 'Connect wallet'}
      </Button>
    )
  }

  const usdc = balance ? `${Number(balance.formatted).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC` : '—'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-9 gap-2 rounded-[9px] border-border bg-surface-1 text-foreground hover:bg-surface-2"
        >
          <span className="size-2 rounded-full bg-success" aria-hidden="true" />
          <span className="tabular font-medium">{usdc}</span>
          <span className="text-border">|</span>
          <span className="tabular text-muted-foreground">{shortAddress(address)}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="border-border bg-popover">
        <div className="px-2 py-1.5">
          <p className="text-[12px] text-muted-foreground">Connected</p>
          <p className="tabular text-[13px] text-foreground">{shortAddress(address)}</p>
        </div>
        <DropdownMenuSeparator className="bg-border" />
        <DropdownMenuItem className="text-foreground focus:bg-surface-2" onClick={() => disconnect()}>
          <LogOut className="size-4" />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
