// the desktop main process and preload, running in this page on the in-page Electron stand-in
import '../../../../../packages/electron-utils/src/android/globals'
import '../../../../../packages/electron-utils/src/android/crypto-patch'
import '../../../../../packages/electron-utils/src/android/host'
import { seedFile } from '../../../../../packages/electron-utils/src/android/fs'
import { registerClose } from '../../../../../packages/electron-utils/src/android/host'
import { fakeWebContents } from '../../../../../packages/electron-utils/src/android/electron'
import { configureSheetsRuntime, createSheetsWindow, requestSheetsClose } from '../../main/sheets-main'
import '../../preload/index'
import { normalizeLang, setUiLang } from '@genoffice/i18n'

setUiLang(normalizeLang(navigator.language))
// the engine is started by the Android app; the code only needs to find a file at this path
seedFile('/engine/xlsx-sidecar', new Uint8Array(1))
configureSheetsRuntime({ preloadPath: '', rendererFile: '', sidecarPath: '/engine/xlsx-sidecar' } as never)
// registers this page as the (one) trusted window and starts the workbook engine
void createSheetsWindow({ includeAiHandlers: false })
registerClose(() => requestSheetsClose(fakeWebContents as never))
