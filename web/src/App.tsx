import { Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Home } from '@/pages/Home'
import { AgentProfile } from '@/pages/AgentProfile'
import { HirePage } from '@/pages/HirePage'
import { PagePlaceholder } from '@/pages/PagePlaceholder'
import { NotFound } from '@/pages/NotFound'

export function App() {
  return (
    <Layout>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/agent/:address" element={<AgentProfile />} />
          <Route path="/hire/:address" element={<HirePage />} />
          <Route
            path="/marketplace"
            element={
              <PagePlaceholder
                title="Marketplace"
                description="Open bounties and jobs posted to the ERC-8183 reference contract, filterable by skill, budget, and status. Arriving in the next build pass."
              />
            }
          />
          <Route
            path="/dashboard"
            element={
              <PagePlaceholder
                title="My dashboard"
                description="Your connected-wallet view of jobs opened and funds in escrow, each with a full status timeline. Arriving in the next build pass."
              />
            }
          />
          <Route
            path="/arbiter"
            element={
              <PagePlaceholder
                title="Arbiter"
                description="The impartial evaluator for ERC-8183 jobs — address, verdict feed, integration snippet, and the scoring methodology. Arriving with the arbiter agent."
              />
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </ErrorBoundary>
    </Layout>
  )
}
