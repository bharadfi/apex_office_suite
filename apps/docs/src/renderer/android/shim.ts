/**
 * Runs the desktop Word renderer inside the Android app's WebView.
 *
 * On desktop the renderer talks to Electron's main process through `window.desktop`. Here the
 * Android app plays that role through `window.AndroidHost` (a JavascriptInterface): it hands over
 * the opened file and stores what the renderer saves. Calls the phone has no counterpart for
 * (printing, updater, desktop-only dialogs) answer with an empty result, so the editor itself
 * is exactly the desktop one.
 */

import { decryptOoxml, encryptOoxml, isEncryptedOoxml } from '../../../../../packages/electron-utils/src/ooxml-encryption'

interface AndroidHost {
  /** the file Android opened: JSON {path,name,hash,base64}, or null when none */
  takePending(): string | null
  /** write the saved document back to the opened file */
  save(path: string, base64: string): boolean
  closeChecked(dirty: boolean): void
  saveDone(ok: boolean): void
  /** the file cannot be opened here (the app tells the user and goes back) */
  refuse(reason: string): void
  /** open the phone's image picker; the answer comes back through window.__apexImagePicked */
  pickImage(): void
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

/** encrypted files waiting for their password, and the password that opened (and re-protects) each */
const locked = new Map<string, Uint8Array>()
const passwords = new Map<string, string>()

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
    const bytes = toBytes(file.base64)
    // a password-protected docx is an OLE2 container, not a zip: ask for the password first
    if (isEncryptedOoxml(Buffer.from(bytes))) {
      locked.set(file.path, bytes)
      return { needsPassword: true, path: file.path, name: file.name }
    }
    const blob = new Blob([bytes as BlobPart])
    return { path: file.path, name: file.name, dataUrl: URL.createObjectURL(blob), hash: file.hash ?? '' }
  },
  consumeNewBlankDoc: async () => false,
  consumeAiDocContent: async () => null,
  consumeHeadlessExport: async () => null,
  confirmDocumentReplace: async () => true,
  openDocxDecrypt: async (path: string, password: string) => {
    const bytes = locked.get(path)
    if (!bytes) return { ok: false, reason: 'error', error: 'The file is no longer available.' }
    try {
      const plain = await decryptOoxml(Buffer.from(bytes), password)
      locked.delete(path)
      passwords.set(path, password)
      const blob = new Blob([plain as unknown as BlobPart])
      const name = decodeURIComponent(path.split('/').pop() ?? 'document.docx')
      return { ok: true, result: { path, name, dataUrl: URL.createObjectURL(blob), hash: '', encrypted: true } }
    } catch (e) {
      const reason = (e as { reason?: string }).reason === 'unsupported' ? 'unsupported' : 'wrong-password'
      return { ok: false, reason }
    }
  },
  setDocPassword: async (path: string | null, password: string | null) => {
    if (path) {
      if (password) passwords.set(path, password)
      else passwords.delete(path)
    }
    return { ok: true }
  },
  saveDocx: async (path: string, data: ArrayBuffer) => {
    const pw = passwords.get(path)
    const out = pw ? encryptOoxml(Buffer.from(data), pw) : null
    return { ok: host?.save(path, toBase64(out ? out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer : data)) ?? false }
  },
  saveDocxTo: async (path: string, data: ArrayBuffer) => ({ ok: host?.save(path, toBase64(data)) ?? false }),
  writeRecoveryCopy: async () => ({ ok: true }),
}

// Closing: the editor answers a "close check" with its unsaved-changes state and can save on request.
let closeCheck: (() => void) | undefined
let closeSave: (() => void) | undefined
let closeState: { dirty: boolean } | undefined
let savedSince = 0
let imageWaiter: ((r: unknown) => void) | undefined
known.pickImage = () =>
  new Promise((resolve) => {
    imageWaiter = resolve
    host?.pickImage()
  })
Object.assign(window, {
  __apexImagePicked: (json: string | null) => {
    const wait = imageWaiter
    imageWaiter = undefined
    wait?.(json ? JSON.parse(json) : null)
  },
})
known.onCloseCheck = (handler: () => void) => {
  closeCheck = handler
  return () => {}
}
known.onCloseSaveRequest = (handler: () => void) => {
  closeSave = handler
  return () => {}
}
known.reportCloseCheck = (state: { dirty: boolean }) => {
  closeState = state
}
const saveOk = known.saveDocx
known.saveDocx = async (...args: never[]) => {
  savedSince++
  return saveOk(...args)
}
Object.assign(window, {
  /** JSON {dirty} after asking the editor; the Android back button uses it */
  __apexCloseCheck: async () => {
    closeState = undefined
    closeCheck?.()
    for (let i = 0; i < 20 && !closeState; i++) await new Promise((r) => setTimeout(r, 25))
    host?.closeChecked(closeState?.dirty ?? false)
  },
  /** save the open document, resolving once it has been written (or after a few seconds) */
  __apexSave: async () => {
    const before = savedSince
    closeSave?.()
    for (let i = 0; i < 80 && savedSince === before; i++) await new Promise((r) => setTimeout(r, 50))
    host?.saveDone(savedSince !== before)
  },
})

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
