/**
 * Runs a desktop text editor (Markdown, HTML) inside the Android app's WebView.
 *
 * On desktop the editor talks to Electron's main process through a preload bridge
 * (`window.markdownApi`, `window.htmlApi`). Here the Android app plays that role through
 * `window.AndroidHost`: it hands over the opened file and stores what the editor saves. Calls the
 * phone has no counterpart for answer with an empty result, so the editor is the desktop one.
 */

interface AndroidHost {
  takePending(): string | null
  save(path: string, base64: string): boolean
  closeChecked(dirty: boolean): void
  saveDone(ok: boolean): void
  updatePreview(text: string): void
  language?(): string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8')

function toBytes(base64: string): Uint8Array {
  const bin = atob(base64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(bin)
}

const PREVIEW_URL = 'https://appassets.androidplatform.net/__preview__/index.html'

/** Install the bridge under `globalName` (the name the desktop preload uses) before the editor starts */
export function installTextShim(globalName: string): void {
  const host = (window as unknown as { AndroidHost?: AndroidHost }).AndroidHost
  let current: { path: string; text: string } | undefined
  let dirty = false
  let closeSave: (() => void) | undefined
  let saveWaiter: ((ok: boolean) => void) | undefined

  const known: Record<string, (...args: never[]) => unknown> = {
    getLanguage: async () => host?.language?.() ?? 'en',
    getTheme: async () => 'system',
    getDocumentTheme: async () => 'follow',
    consumePending: async () => {
      const raw = host?.takePending()
      if (!raw) return null
      const file = JSON.parse(raw) as { path: string; base64: string }
      current = { path: file.path, text: decoder.decode(toBytes(file.base64)) }
      return file.path
    },
    readFile: async (path: string) => (current && current.path === path ? current.text : ''),
    consumeHeadlessExport: async () => null,
    save: async (request: { text: string; mode: string }) => {
      if (!current) return { ok: false, error: 'There is no file to save to.' }
      if (request.mode === 'saveAs') return { ok: false, error: 'Save As is not available on Android yet.' }
      const ok = host?.save(current.path, toBase64(encoder.encode(request.text))) ?? false
      if (!ok) return { ok: false, error: 'The file could not be written.' }
      current.text = request.text
      return { ok: true, path: current.path }
    },
    setDirty: (value: boolean) => {
      dirty = value === true
    },
    onCloseSaveRequest: (handler: () => void) => {
      closeSave = handler
      return () => {}
    },
    sendCloseSaveResult: (ok: boolean) => {
      saveWaiter?.(ok)
    },
    sendSaveRequestAck: () => {},
    getPreviewInfo: async () => ({ url: PREVIEW_URL }),
    updatePreview: (text: string) => host?.updatePreview(text),
  }

  const api = new Proxy(known, {
    get(target, key) {
      if (typeof key !== 'string' || key === 'then') return undefined
      if (key in target) return target[key]
      if (/^on[A-Z]/.test(key)) return () => () => {}
      return async () => null
    },
  })
  const empty = new Proxy({}, { get: (_t, key) => (typeof key === 'string' && key !== 'then' ? async () => null : undefined) })
  Object.assign(window, { [globalName]: api, aiNamingApi: empty, projectApi: empty })

  Object.assign(window, {
    __apexCloseCheck: async () => host?.closeChecked(dirty),
    __apexSave: async () => {
      const done = new Promise<boolean>((resolve) => {
        saveWaiter = resolve
        setTimeout(() => resolve(false), 5000)
      })
      closeSave?.()
      host?.saveDone(await done)
    },
  })

  // Android WebView can report a 0px layout viewport; size the root chain from the visual viewport.
  const fit = (): void => {
    const height = window.visualViewport?.height ?? window.innerHeight
    if (!height) return
    for (const el of [document.documentElement, document.body, document.getElementById('root')]) {
      el?.style.setProperty('height', `${height}px`, 'important')
    }
  }
  fit()
  window.addEventListener('DOMContentLoaded', fit)
  window.addEventListener('resize', fit)
  window.visualViewport?.addEventListener('resize', fit)
}
