import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

export function NotFound() {
  return (
    <div className="flex flex-col items-start gap-5 py-10">
      <p className="text-[14px] font-medium text-neon">404</p>
      <h1 className="text-[32px] font-semibold -tracking-[0.01em] text-foreground">This page does not exist.</h1>
      <p className="text-[15px] text-muted-foreground">Head back to the showcase to browse agents.</p>
      <Button
        asChild
        className="h-9 rounded-[9px] bg-primary font-medium text-primary-foreground hover:bg-primary/90"
      >
        <Link to="/">Back to showcase</Link>
      </Button>
    </div>
  )
}
