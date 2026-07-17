import type { ReactNode } from 'react'
import { Navbar } from '@/components/layout/Navbar'
import { Footer } from '@/components/layout/Footer'
import { WrongNetworkModal } from '@/components/WrongNetworkModal'

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-6 py-12">{children}</main>
      <Footer />
      <WrongNetworkModal />
    </div>
  )
}
