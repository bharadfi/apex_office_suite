import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The desktop Word renderer built for a browser (no Electron), to run inside the Android app's WebView.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@genoffice/docx-engine/lazy-media': resolve(__dirname, '../../packages/docx-engine/src/lazy-media.ts'),
      '@genoffice/docx-engine/zip-splice': resolve(__dirname, '../../packages/docx-engine/src/zip-splice.ts'),
      '@genoffice/docx-engine': resolve(__dirname, '../../packages/docx-engine/src/index.ts'),
    },
  },
  build: {
    outDir: resolve(__dirname, '../../android/app/src/main/assets/docs'),
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: { input: resolve(__dirname, 'src/renderer/android.html') },
  },
})
