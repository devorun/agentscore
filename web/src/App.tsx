import { Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Home } from '@/pages/Home'
import { AgentProfile } from '@/pages/AgentProfile'
import { HirePage } from '@/pages/HirePage'
import { Marketplace } from '@/pages/Marketplace'
import { Dashboard } from '@/pages/Dashboard'
import { Arbiter } from '@/pages/Arbiter'
import { JobDetail } from '@/pages/JobDetail'
import { NotFound } from '@/pages/NotFound'

export function App() {
  return (
    <Layout>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/agent/:address" element={<AgentProfile />} />
          <Route path="/hire/:address" element={<HirePage />} />
          <Route path="/marketplace" element={<Marketplace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/arbiter" element={<Arbiter />} />
          <Route path="/job/:id" element={<JobDetail />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </ErrorBoundary>
    </Layout>
  )
}
