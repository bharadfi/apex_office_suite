// the desktop main process and preload, running in this page on the in-page Electron stand-in
import '../../../../../packages/electron-utils/src/android/globals'
import '../../../../../packages/electron-utils/src/android/crypto-patch'
import { openedPath } from '../../../../../packages/electron-utils/src/android/host'
import { fakeWebContents } from '../../../../../packages/electron-utils/src/android/electron'
import { configurePdfRuntime, grantAndTrack, registerPdfIpc } from '../../main/pdf-main'
import '../../preload/index'
import { normalizeLang, setUiLang } from '@genoffice/i18n'

setUiLang(normalizeLang(navigator.language))
configurePdfRuntime({ preloadPath: '', rendererUrl: undefined, rendererFile: '', createDocument: () => undefined } as never)
registerPdfIpc()
grantAndTrack(fakeWebContents as never, openedPath || null)
