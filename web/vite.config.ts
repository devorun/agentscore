import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// The one scoring module lives with the backend (API + settlement workers use
// it); the app imports that exact file, so a browser-computed score is the
// same code as the API's.
const sharedScore = path.resolve(import.meta.dirname, '../backend/src/lib/score.ts')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared/score': sharedScore,
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5173,
    // Serve that one file from outside web/ in dev (the build bundles it).
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), sharedScore] },
  },
})
