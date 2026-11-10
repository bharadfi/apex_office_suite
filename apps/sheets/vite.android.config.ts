import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const rt = (file: string): string => resolve(__dirname, '../../packages/electron-utils/src/android', file)

// The desktop Sheets app (screen, preload and main process) built for a browser, to run inside the Android WebView.
// electron-vite's ?asset imports give a file path; on the phone nothing reads those files, so give a plain path
const assetPaths = {
  name: 'android-asset-paths',
  enforce: 'pre' as const,
  resolveId(id: string) {
    if (/^(node:)?stream\/promises$/.test(id)) return rt('stub.ts')
    if (id.endsWith('?asset') || id.includes('?asset&')) return '\0asset:' + id.split('?')[0]!.split('/').pop()
    return null
  },
  load(id: string) {
    if (/stream-browserify[\\/]promises/.test(id)) return 'export const pipeline = async () => { throw new Error("Streams are not available on Android") }; export const finished = async () => {}; export default {}'
    return id.startsWith('\0asset:') ? `export default '/app/assets/${id.slice(7)}'` : null
  },
}

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  define: { __dirname: JSON.stringify('/app'), global: 'globalThis' },
  plugins: [
    assetPaths,
    react(),
    nodePolyfills({
      include: ['crypto', 'buffer', 'stream', 'util', 'process', 'path', 'os', 'zlib', 'events', 'url', 'assert', 'string_decoder', 'timers', 'querystring'],
      globals: { Buffer: false, process: false, global: false },
      protocolImports: true,
    }),
  ],
  resolve: {
    alias: [
      { find: /^electron$/, replacement: rt('electron.ts') },
      { find: /^(node:)?fs\/promises$/, replacement: rt('fs-promises.ts') },
      { find: /^(node:)?fs$/, replacement: rt('fs.ts') },
      { find: /^(node:)?stream\/promises$/, replacement: rt('stub.ts') },
      { find: /^(node:)?child_process$/, replacement: rt('child-process.ts') },
      { find: /^(node:)?readline$/, replacement: rt('readline.ts') },
      { find: /^undici(\/.*)?$/, replacement: rt('stub.ts') },
      { find: /^(node:)?(diagnostics_channel|async_hooks)$/, replacement: rt('stub.ts') },
      { find: /^(node:)?(worker_threads|http|https|net|tls|dgram|module|cluster|v8|vm|inspector|http2|dns|dns\/promises|perf_hooks|repl|tty|constants|sys)$/, replacement: rt('stub.ts') },
      { find: '@genoffice/docx-engine/lazy-media', replacement: resolve(__dirname, '../../packages/docx-engine/src/lazy-media.ts') },
    ],
  },
  build: {
    outDir: resolve(__dirname, '../../android/app/src/main/assets/sheets'),
    emptyOutDir: true,
    target: 'es2022',
    minify: process.env.ANDROID_DEBUG ? false : 'esbuild',
    chunkSizeWarningLimit: 20000,
    rollupOptions: { shimMissingExports: true, input: resolve(__dirname, 'src/renderer/android.html') },
  },
})