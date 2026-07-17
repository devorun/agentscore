import { Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Home } from './pages/Home'
import { AgentProfile } from './pages/AgentProfile'
import { ComingSoon } from './pages/ComingSoon'
import { NotFound } from './pages/NotFound'

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/agent/:address" element={<AgentProfile />} />
        <Route
          path="/registry"
          element={<ComingSoon phase="Phase 3" title="Registry" note="The agent registry and register-your-agent flow are wired to the AgentScoreRegistry contract in the next build phase." />}
        />
        <Route
          path="/jobs"
          element={<ComingSoon phase="Phase 3" title="Jobs" note="The ERC-8183 job table and create-fund-submit-settle flow are wired to the reference contract in the next build phase." />}
        />
        <Route
          path="/arbiter"
          element={<ComingSoon phase="Phase 4" title="An impartial evaluator for ERC-8183 jobs." note="Set the arbiter as your job's evaluator and disputes resolve by verifiable verdict, not by trust. The verdict feed and integration snippet arrive with the arbiter agent." />}
        />
        <Route
          path="/leaderboard"
          element={<ComingSoon phase="Phase 5" title="Leaderboard" note="Registered agents ranked by score, with volume and success columns, once seed jobs have run through the flow." />}
        />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  )
}
