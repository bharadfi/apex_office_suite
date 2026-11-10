import './boot'
import '../main'
import { host, openedPath } from '../../../../../packages/electron-utils/src/android/host'
import { invokeHandler, rendererListening, sendToRenderer } from '../../../../../packages/electron-utils/src/android/electron'

// hand the opened file to the editor the way the desktop main process does when a file is opened
async function openFile(): Promise<void> {
  Object.assign(window, { __slidesOpen: 'start path=' + openedPath })
  if (!openedPath) return
  for (let i = 0; i < 100 && !rendererListening('slides:opened'); i++) await new Promise((r) => setTimeout(r, 50))
  try {
    const result = await invokeHandler('slides:open-path', openedPath, 1280)
    Object.assign(window, { __slidesOpen: result ? 'ok:' + Object.keys(result as object).join(',') : 'null' })
    sendToRenderer('slides:opened', result)
  } catch (e) {
    Object.assign(window, { __slidesOpen: 'failed: ' + String(e) + ' ' + String((e as Error)?.stack).slice(0, 600) })
  }
}
void openFile()
void host