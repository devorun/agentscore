import { useAccount, useSwitchChain } from 'wagmi'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { arcTestnet } from '@/lib/config'

/** Blurs the app behind a blocking modal when the wallet is on the wrong chain. */
export function WrongNetworkModal() {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending } = useSwitchChain()

  if (!isConnected || chainId === arcTestnet.id) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 backdrop-blur-md">
      <Card className="flex max-w-md flex-col items-center gap-4 rounded-xl border-border bg-card p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-warning/15 text-warning">
          <AlertTriangle className="size-6" />
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-[20px] font-semibold text-foreground">Wrong network</h2>
          <p className="text-[14px] text-muted-foreground">
            This app runs on Arc Testnet. Switch network to continue.
          </p>
        </div>
        <Button
          className="h-10 rounded-[9px] bg-primary font-medium text-primary-foreground hover:bg-primary/90"
          disabled={isPending}
          onClick={() => switchChain({ chainId: arcTestnet.id })}
        >
          {isPending ? 'Switching…' : 'Switch to Arc Testnet'}
        </Button>
      </Card>
    </div>
  )
}
