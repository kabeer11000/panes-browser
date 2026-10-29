import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          internal: resolve('src/preload/internal.ts'),
          pip: resolve('src/preload/pip.ts'),
          popover: resolve('src/preload/popover.ts'),
          permission: resolve('src/preload/permission.ts'),
          panel: resolve('src/preload/panel.ts'),
          tabcard: resolve('src/preload/tabcard.ts'),
          dock: resolve('src/preload/dock.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          internal: resolve('src/renderer/internal.html'),
          pip: resolve('src/renderer/pip.html'),
          popover: resolve('src/renderer/popover.html'),
          error: resolve('src/renderer/error.html'),
          welcome: resolve('src/renderer/welcome.html'),
          panel: resolve('src/renderer/panel.html'),
          permission: resolve('src/renderer/permission.html'),
          tabcard: resolve('src/renderer/tabcard.html'),
          dock: resolve('src/renderer/dock.html')
        }
      }
    }
  }
})
