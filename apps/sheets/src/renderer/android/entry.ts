import './boot'
import '../main'
import { openedPath } from '../../../../../packages/electron-utils/src/android/host'
import { answerNextOpenDialog, sendToRenderer, rendererListening } from '../../../../../packages/electron-utils/src/android/electron'

// open the file the way the desktop File > Open does: the renderer asks main to pick a file, and the pick is ours
async function openFile(): Promise<void> {
  if (!openedPath) return
  for (let i = 0; i < 100 && !rendererListening('menu:action'); i++) await new Promise((r) => setTimeout(r, 50))
  answerNextOpenDialog(openedPath)
  sendToRenderer('menu:action', 'open')
}
void openFile()