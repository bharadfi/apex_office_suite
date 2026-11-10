/**
 * A stand-in for Electron that lives in the same page as the editor, so the desktop app's own main
 * process and preload code can run unchanged inside Android's WebView.
 *
 * `ipcRenderer.invoke` calls the handler `ipcMain.handle` registered, `webContents.send` reaches the
 * renderer's listeners, and every window, dialog or system call the phone cannot honour answers with
 * a harmless default.
 */

import { realRoot } from './fs'

type Listener = (event: unknown, ...args: unknown[]) => unknown

/** ask the phone's user a question with buttons; resolves with the chosen button's index */
const dialogHost = (window as unknown as { AndroidHost?: { showDialog?(json: string): void } }).AndroidHost
let dialogWaiter: ((index: number) => void) | undefined
Object.assign(window, { __dialogAnswer: (index: number) => dialogWaiter?.(index) })
function askAndroid(options: { message?: string; detail?: string; buttons?: string[]; cancelId?: number }): Promise<number> {
  const cancel = options.cancelId ?? (options.buttons ? options.buttons.length - 1 : 0)
  if (!dialogHost?.showDialog) return Promise.resolve(cancel)
  return new Promise((resolve) => {
    dialogWaiter = resolve
    dialogHost.showDialog!(JSON.stringify({ message: options.message ?? '', detail: options.detail ?? '', buttons: options.buttons ?? ['OK'] }))
  })
}

let nextOpenDialogPath: string | undefined
/** the next file-open dialog answers with this path (the Android app opened the file already) */
export function answerNextOpenDialog(path: string): void {
  nextOpenDialogPath = path
}

const handlers = new Map<string, Listener>()
const mainListeners = new Map<string, Set<Listener>>()
const rendererListeners = new Map<string, Set<Listener>>()

const add = (map: Map<string, Set<Listener>>, channel: string, fn: Listener): void => {
  const set = map.get(channel) ?? new Set<Listener>()
  set.add(fn)
  map.set(channel, set)
}

/** a value that can be called, constructed or read from without ever failing */
function deep(): unknown {
  const fn = function () {} as unknown as object
  return new Proxy(fn, {
    get: (_t, key) => (typeof key === 'symbol' || key === 'then' ? undefined : deep()),
    apply: () => undefined,
    construct: () => ({}),
  })
}

/** whatever a window or an app object is asked for that has no meaning on the phone */
function inert<T extends object>(base: T, overrides: Record<string, unknown> = {}): T {
  return new Proxy(base, {
    get(target, key, receiver) {
      if (typeof key === 'symbol') return Reflect.get(target, key, receiver)
      if (key in overrides) return overrides[key]
      if (key in target) return Reflect.get(target, key, receiver)
      if (key === 'then') return undefined
      // anything else can be called, constructed or read further, and answers nothing
      return deep()
    },
  })
}

const sender = (): unknown => webContentsObject

const webContentsObject: Record<string, unknown> = inert(
  {},
  {
    id: 1,
    send: (channel: string, ...args: unknown[]) => {
      for (const fn of rendererListeners.get(channel) ?? []) fn({ sender: webContentsObject }, ...args)
    },
    isDestroyed: () => false,
    isLoading: () => false,
    getURL: () => location.href,
    getTitle: () => document.title,
    executeJavaScript: async () => undefined,
    session: inert({}),
    on: () => webContentsObject,
    once: () => webContentsObject,
    off: () => webContentsObject,
    removeListener: () => webContentsObject,
    setWindowOpenHandler: () => undefined,
    focus: () => undefined,
    getOwnerBrowserWindow: () => windowObject,
  },
)

const windowObject: Record<string, unknown> = inert(
  {},
  {
    id: 1,
    webContents: webContentsObject,
    isDestroyed: () => false,
    isMinimized: () => false,
    isMaximized: () => false,
    isFullScreen: () => false,
    isFocused: () => true,
    isVisible: () => true,
    getBounds: () => ({ x: 0, y: 0, width: innerWidth, height: innerHeight }),
    getContentBounds: () => ({ x: 0, y: 0, width: innerWidth, height: innerHeight }),
    on: () => windowObject,
    once: () => windowObject,
    off: () => windowObject,
  },
)

export const ipcMain = {
  handle: (channel: string, fn: Listener) => {
    handlers.set(channel, fn)
  },
  handleOnce: (channel: string, fn: Listener) => {
    handlers.set(channel, fn)
  },
  removeHandler: (channel: string) => {
    handlers.delete(channel)
  },
  on: (channel: string, fn: Listener) => {
    add(mainListeners, channel, fn)
    return ipcMain
  },
  once: (channel: string, fn: Listener) => {
    add(mainListeners, channel, fn)
    return ipcMain
  },
  off: (channel: string, fn: Listener) => {
    mainListeners.get(channel)?.delete(fn)
    return ipcMain
  },
  removeListener: (channel: string, fn: Listener) => {
    mainListeners.get(channel)?.delete(fn)
    return ipcMain
  },
  removeAllListeners: (channel?: string) => {
    if (channel) mainListeners.delete(channel)
    else mainListeners.clear()
    return ipcMain
  },
}

export const ipcRenderer = {
  invoke: async (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel)
    if (!handler) return undefined // a desktop-only channel: the phone has nothing to answer
    return handler({ sender: sender(), senderFrame: {} }, ...args)
  },
  send: (channel: string, ...args: unknown[]) => {
    for (const fn of mainListeners.get(channel) ?? []) fn({ sender: sender(), returnValue: undefined }, ...args)
  },
  sendSync: () => undefined,
  sendToHost: () => undefined,
  on: (channel: string, fn: Listener) => {
    add(rendererListeners, channel, fn)
    return ipcRenderer
  },
  once: (channel: string, fn: Listener) => {
    add(rendererListeners, channel, fn)
    return ipcRenderer
  },
  off: (channel: string, fn: Listener) => {
    rendererListeners.get(channel)?.delete(fn)
    return ipcRenderer
  },
  removeListener: (channel: string, fn: Listener) => {
    rendererListeners.get(channel)?.delete(fn)
    return ipcRenderer
  },
  removeAllListeners: (channel?: string) => {
    if (channel) rendererListeners.delete(channel)
    else rendererListeners.clear()
    return ipcRenderer
  },
}

/** what a preload exposes becomes a property of window, as in an Electron renderer */
export const contextBridge = {
  exposeInMainWorld: (name: string, api: unknown) => {
    Object.defineProperty(window, name, { value: api, configurable: true, writable: true })
  },
}

/** send something to the renderer as the main process would (used by the Android host) */
export function sendToRenderer(channel: string, ...args: unknown[]): void {
  ;(webContentsObject.send as (c: string, ...a: unknown[]) => void)(channel, ...args)
}

/** whether the renderer has registered for a channel yet */
export function rendererListening(channel: string): boolean {
  return (rendererListeners.get(channel)?.size ?? 0) > 0
}

/** call a handler the way the renderer does (used by the Android host) */
export function invokeHandler(channel: string, ...args: unknown[]): Promise<unknown> {
  return ipcRenderer.invoke(channel, ...args)
}

const readyPromise = Promise.resolve()

export const app = inert(
  {},
  {
    getPath: (name: string) => `/${realRoot ? realRoot.slice(1) : 'data'}/${name}`,
    getAppPath: () => '/app',
    getName: () => 'Apex Office',
    getVersion: () => '1.0.5',
    getLocale: () => navigator.language || 'en',
    getSystemLocale: () => navigator.language || 'en',
    isPackaged: true,
    isReady: () => true,
    whenReady: () => readyPromise,
    requestSingleInstanceLock: () => true,
    on: () => app,
    once: () => app,
    off: () => app,
    removeListener: () => app,
    commandLine: inert({}),
    dock: inert({}),
  },
)

class BrowserWindowStub {
  static getAllWindows(): unknown[] {
    return [windowObject]
  }
  static getFocusedWindow(): unknown {
    return windowObject
  }
  static fromWebContents(): unknown {
    return windowObject
  }
  static fromId(): unknown {
    return windowObject
  }
  constructor() {
    return windowObject as unknown as BrowserWindowStub
  }
}
export const BrowserWindow = BrowserWindowStub
export const BrowserView = BrowserWindowStub
export const WebContentsView = BrowserWindowStub

export const webContents = inert(
  {},
  {
    getAllWebContents: () => [webContentsObject],
    getFocusedWebContents: () => webContentsObject,
    fromId: () => webContentsObject,
  },
)

/** pickers are the Android app's job; until it supplies one, the user simply cancels */
export const dialog = inert(
  {},
  {
    showOpenDialog: async () => {
      const path = nextOpenDialogPath
      nextOpenDialogPath = undefined
      return path ? { canceled: false, filePaths: [path] } : { canceled: true, filePaths: [] }
    },
    showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
    showMessageBox: async (...args: unknown[]) => {
      const options = (args.find((a) => a && typeof a === 'object' && 'buttons' in (a as object)) ?? {}) as { message?: string; detail?: string; buttons?: string[]; cancelId?: number }
      const response = await askAndroid(options)
      return { response, checkboxChecked: false }
    },
    showMessageBoxSync: () => 0,
    showErrorBox: () => undefined,
  },
)

export const shell = inert({}, { openExternal: async () => undefined, openPath: async () => '' })
export const clipboard = inert({}, { readText: () => '', readHTML: () => '', availableFormats: () => [] })
export const nativeImage = inert({}, { createFromBuffer: () => inert({}), createFromPath: () => inert({}), createEmpty: () => inert({}) })
export const net = inert({}, { fetch: (...a: Parameters<typeof fetch>) => fetch(...a) })
export const screen = inert({}, { getPrimaryDisplay: () => ({ workAreaSize: { width: innerWidth, height: innerHeight }, scaleFactor: devicePixelRatio, bounds: { x: 0, y: 0, width: innerWidth, height: innerHeight } }), getAllDisplays: () => [] })
export const session = inert({}, { defaultSession: inert({}), fromPartition: () => inert({}) })
export const Menu = Object.assign(class {}, { setApplicationMenu: () => undefined, buildFromTemplate: () => inert({}), getApplicationMenu: () => null })
export const MenuItem = class {}
export const Tray = class {}
export const Notification = Object.assign(class {}, { isSupported: () => false })
export const desktopCapturer = inert({}, { getSources: async () => [] })
export const powerMonitor = inert({})
export const powerSaveBlocker = inert({}, { start: () => 0, stop: () => undefined })
export const safeStorage = inert({}, { isEncryptionAvailable: () => false })
export const protocol = inert({})
export const globalShortcut = inert({})
export const nativeTheme = inert({}, { shouldUseDarkColors: false })
export const systemPreferences = inert({})
export const utilityProcess = inert({})
export const autoUpdater = inert({})
export const crashReporter = inert({})
export const webUtils = inert({}, { getPathForFile: () => '' })
export const MessageChannelMain = class {}
export const TouchBar = class {}

export default { app, BrowserWindow, ipcMain, ipcRenderer, contextBridge, dialog, shell, clipboard, nativeImage, net, screen, session, Menu, webContents, webUtils }

/** the one window's contents, for code that needs to be handed a webContents */
export const fakeWebContents = webContentsObject
