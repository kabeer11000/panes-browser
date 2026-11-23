import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The web board (tasks/shared-spaces.md, phase 6): built into share/web/public, which the relay's image serves as it
 * is (share/server/Dockerfile), so the image never installs packages. Build: bun run build:share-web
 *
 * Develop: bun run dev:share-web, then open http://localhost:5199/s/<room>#<secret> (an invite link's path and secret):
 * the relay's routes go to SHARE_RELAY (the deployed relay unless set), so the page joins real rooms.
 */
const relay = process.env.SHARE_RELAY ?? 'https://panes-share.onrender.com'
export default defineConfig({
  root: resolve(__dirname),
  base: '/',
  publicDir: false,
  plugins: [react()],
  resolve: { alias: { '@shared': resolve(__dirname, '../../src/shared') } },
  server: {
    port: 5199,
    proxy: {
      '/sync': { target: relay, ws: true, changeOrigin: true },
      '/blob': { target: relay, changeOrigin: true },
      '/ice': { target: relay, changeOrigin: true }
    }
  },
  build: {
    outDir: resolve(__dirname, 'public'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false
  }
})
