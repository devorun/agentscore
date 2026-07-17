import { Component, type ErrorInfo, type ReactNode } from 'react'
import { StatusMessage } from './ui'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

// Last line of defense: any uncaught render error shows a message with the real
// reason and a reload, never a blank screen (§7 — states are mandatory).
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
        <div style={{ maxWidth: '640px', margin: '0 auto', padding: 'var(--space-8) var(--space-5)' }}>
          <StatusMessage
            tone="negative"
            title="Something went wrong rendering this page"
            action={
              <button className="btn btn-small" onClick={() => window.location.reload()}>
                Reload
              </button>
            }
          >
            {this.state.error.message}
          </StatusMessage>
        </div>
      )
    }
    return this.props.children
  }
}
