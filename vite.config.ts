import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import electronRenderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue(),
    electron([
      {
        entry: 'electron/main/index.ts',
        onstart(args) {
          args.startup()
        },
        vite: {
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: ['electron', 'sql.js', 'music-metadata', 'NeteaseCloudMusicApi', 'axios', 'electron-updater'],
              output: {
                banner: `// BeatZFit auto-relaunch: if ELECTRON_RUN_AS_NODE is set (e.g. by CatPaw/Cursor/VSCode IDE),
// Electron runs as plain Node.js (no GUI). Detect and relaunch as proper Electron.
if (process.env.ELECTRON_RUN_AS_NODE) {
  delete process.env.ELECTRON_RUN_AS_NODE;
  var _cp = require('child_process');
  _cp.spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    stdio: 'ignore',
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: undefined })
  }).unref();
  process.exit(0);
}
`
              }
            }
          }
        }
      },
      {
        entry: 'electron/preload/index.ts',
        onstart(args) {
          args.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron/preload'
          }
        }
      }
    ]),
    electronRenderer()
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: ''
      }
    }
  },
  optimizeDeps: {
    // Only scan src/ for dependency optimization — excludes 3d_Design/ prototypes
    // that reference packages (dat.gui, web-audio-beat-detector) not in package.json
    entries: ['src/**/*.ts', 'src/**/*.tsx', 'src/**/*.vue'],
  },
})
