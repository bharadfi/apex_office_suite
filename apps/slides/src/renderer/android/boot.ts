// the desktop main process and preload, running in this page on the in-page Electron stand-in
import '../../../../../packages/electron-utils/src/android/globals'
import '../../../../../packages/electron-utils/src/android/crypto-patch'
import '../../../../../packages/electron-utils/src/android/host'
import { registerSlidesIpc, requestSlidesClose } from '../../main/slides-main'
import { registerClose } from '../../../../../packages/electron-utils/src/android/host'
import { fakeWebContents } from '../../../../../packages/electron-utils/src/android/electron'
import '../../preload/index'
import { normalizeLang, setUiLang } from '@genoffice/i18n'

setUiLang(normalizeLang(navigator.language))
registerSlidesIpc()
registerClose(() => requestSlidesClose(fakeWebContents as never))
