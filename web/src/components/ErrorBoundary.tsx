import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

// Last line of defense: any uncaught render error shows the real reason with a
// reload, never a blank screen.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <Card className="mx-auto flex max-w-xl flex-col items-start gap-4 rounded-xl border-destructive/40 bg-card p-8">
          <h2 className="text-[20px] font-semibold text-foreground">Something went wrong rendering this page</h2>
          <p className="text-[14px] text-muted-foreground">{this.state.error.message}</p>
          <Button
            className="h-9 rounded-[9px] bg-primary font-medium text-primary-foreground hover:bg-primary/90"
            onClick={() => window.location.reload()}
          >
            Reload
          </Button>
        </Card>
      )
    }
    return this.props.children
  }
}
