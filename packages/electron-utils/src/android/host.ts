/**
 * The Android side of the in-page main process: puts the opened document into the memory file system
 * at a plain path (the code expects paths, not content:// addresses), and writes the bytes back to the
 * real file whenever the editor saves to that path.
 */
import { onFileWritten, seedFile } from './fs'

interface AndroidHost {
  takePending(): string | null
  save(path: string, base64: string): boolean
  closeChecked(dirty: boolean): void
  saveDone(ok: boolean): void
  refuse(reason: string): void
  language?(): string
}

export const host = (window as unknown as { AndroidHost?: AndroidHost }).AndroidHost

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

let uri = ''
export let openedPath = ''
export let openedName = ''

const raw = host?.takePending()
if (raw) {
  const file = JSON.parse(raw) as { path: string; realPath?: string; name: string; base64: string }
  uri = file.path
  openedName = file.name
  if (file.realPath) {
    // already a real file on the phone (the workbook engine opens it by path); the host copies saves back
    openedPath = file.realPath
  } else {
    openedPath = `/storage/${file.name}`
    seedFile(openedPath, toBytes(file.base64))
  }
}

let saves = 0
export const saveCount = (): number => saves

onFileWritten((path, data) => {
  // only the opened document goes back to the phone; scratch files stay in memory
  if (path === openedPath && uri) {
    saves++
    host?.save(uri, toBase64(data))
  }
})

// Android WebView can report a 0px layout viewport (so 100% and 100vh collapse); size the root chain from the visual viewport
const fit = (): void => {
  const height = window.visualViewport?.height ?? window.innerHeight
  if (!height) return
  for (const el of [document.documentElement, document.body, document.getElementById('root')]) {
    el?.style.setProperty('height', height + 'px', 'important')
  }
}
fit()
window.addEventListener('DOMContentLoaded', fit)
window.addEventListener('resize', fit)
window.visualViewport?.addEventListener('resize', fit)

// keep page errors where a debugger can read them without reloading the page
const errors: string[] = []
Object.assign(window, { __errors: errors })
window.addEventListener('error', (e) => errors.push(String(e.message) + ' ' + String(e.error?.stack ?? '').slice(0, 500)))
window.addEventListener('unhandledrejection', (e) => errors.push('rejected: ' + String((e.reason as Error)?.stack ?? e.reason).slice(0, 700)))

/** the Back button: ask the app's own close guard (it shows its Save / Don't Save / Cancel question) and report whether to leave */
export function registerClose(guard: () => Promise<boolean>): void {
  Object.assign(window, {
    __apexClose: async () => {
      let proceed = false
      try {
        proceed = await guard()
      } catch {
        proceed = false
      }
      if (proceed) host?.saveDone(true) // the app leaves the document
    },
  })
}
