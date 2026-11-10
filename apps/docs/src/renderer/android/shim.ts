/**
 * Runs the desktop Word renderer inside the Android app's WebView.
 *
 * On desktop the renderer talks to Electron's main process through `window.desktop`. Here the
 * Android app plays that role through `window.AndroidHost` (a JavascriptInterface): it hands over
 * the opened file and stores what the renderer saves. Calls the phone has no counterpart for
 * (printing, updater, desktop-only dialogs) answer with an empty result, so the editor itself
 * is exactly the desktop one.
 */

interface AndroidHost {
  /** the file Android opened: JSON {path,name,hash,base64}, or null when none */
  takePending(): string | null
  /** write the saved document back to the opened file */
  save(path: string, base64: string): boolean
  language?(): string
}

const host = (window as unknown as { AndroidHost?: AndroidHost }).AndroidHost

function toBytes(base64: string): Uint8Array {
  const bin = atob(base64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

const known: Record<string, (...args: never[]) => unknown> = {
  getLanguage: async () => (host?.language?.() as string | undefined) ?? 'en',
  getSystemLocale: async () => navigator.language,
  getTheme: async () => 'system',
  getDocumentTheme: async () => 'follow',
  getAutoSaveDefault: async () => 'off',
  getAuthorName: async () => '',
  consumePendingOpenDocx: async () => {
    const raw = host?.takePending()
    if (!raw) return null
    const file = JSON.parse(raw) as { path: string; name: string; hash?: string; base64: string }
    const blob = new Blob([toBytes(file.base64) as BlobPart])
    return { path: file.path, name: file.name, dataUrl: URL.createObjectURL(blob), hash: file.hash ?? '' }
  },
  consumeNewBlankDoc: async () => false,
  consumeAiDocContent: async () => null,
  consumeHeadlessExport: async () => null,
  confirmDocumentReplace: async () => true,
  saveDocx: async (path: string, data: ArrayBuffer) => ({ ok: host?.save(path, toBase64(data)) ?? false }),
  saveDocxTo: async (path: string, data: ArrayBuffer) => ({ ok: host?.save(path, toBase64(data)) ?? false }),
  writeRecoveryCopy: async () => ({ ok: true }),
}

const desktop = new Proxy(known, {
  get(target, key) {
    if (typeof key !== 'string' || key === 'then') return undefined
    if (key in target) return target[key]
    // subscriptions return an unsubscribe function; everything else answers "nothing"
    if (/^on[A-Z]/.test(key)) return () => () => {}
    return async () => null
  },
})

const empty = new Proxy({}, { get: (_t, key) => (typeof key === 'string' && key !== 'then' ? async () => null : undefined) })

Object.assign(window, { desktop, aiNamingApi: empty, projectApi: empty })

// Android WebView can report a 0px layout viewport (so 100% and 100vh collapse) while the visual
// viewport is right; size the root chain from the visual viewport instead.
function fitToViewport(): void {
  const height = window.visualViewport?.height ?? window.innerHeight
  if (!height) return
  for (const el of [document.documentElement, document.body, document.getElementById('root')]) {
    el?.style.setProperty('height', `${height}px`, 'important')
  }
}
fitToViewport()
window.addEventListener('DOMContentLoaded', fitToViewport)
window.addEventListener('resize', fitToViewport)
window.visualViewport?.addEventListener('resize', fitToViewport)
