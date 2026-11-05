import { contextBridge, ipcRenderer } from 'electron'
import type { Lang } from '@genoffice/i18n'
import { installDropOpenBridge } from '@genoffice/electron-utils/drop-open'
import { PDF_CHANNELS } from '../shared/ipc'
import type { PdfApi, UiTheme } from '../shared/ipc'

const api: PdfApi = {
  consumePending: () => ipcRenderer.invoke(PDF_CHANNELS.consumePending),
  openSourcePath: (path: string) => ipcRenderer.invoke('home:open-path', path),
  readFile: (path) => ipcRenderer.invoke(PDF_CHANNELS.readFile, path),
  readFileChunk: (path: string, start: number, end: number) =>
    ipcRenderer.invoke(PDF_CHANNELS.readFileChunk, path, start, end),
  decryptPdf: (bytes, password) => ipcRenderer.invoke(PDF_CHANNELS.decryptPdf, bytes, password),
  save: (request) => ipcRenderer.invoke(PDF_CHANNELS.save, request),
  pickAttachmentFile: () => ipcRenderer.invoke(PDF_CHANNELS.pickAttachmentFile),
  exportAttachment: (path, name, bytesBase64) =>
    ipcRenderer.invoke(PDF_CHANNELS.exportAttachment, path, name, bytesBase64),
  requestRedactionCopy: (path) => ipcRenderer.invoke(PDF_CHANNELS.requestRedactionCopy, path),
  autoRename: (path, baseName) => ipcRenderer.invoke(PDF_CHANNELS.autoRename, path, baseName),
  isUntitled: (path) => ipcRenderer.invoke(PDF_CHANNELS.isUntitled, path),
  validateTextEdits: (request) => ipcRenderer.invoke(PDF_CHANNELS.validateTextEdits, request),
  listEditFonts: () => ipcRenderer.invoke(PDF_CHANNELS.listEditFonts),
  canDrawText: (text, font, bold, italic) =>
    ipcRenderer.invoke(PDF_CHANNELS.canDrawText, text, font, bold, italic),
  listPageImages: (path) => ipcRenderer.invoke(PDF_CHANNELS.listPageImages, path),
  listStaticFormFills: (path) => ipcRenderer.invoke(PDF_CHANNELS.listStaticFormFills, path),
  ocrPage: (png) => ipcRenderer.invoke(PDF_CHANNELS.ocrPage, png),
  pageImagePng: (request) => ipcRenderer.invoke(PDF_CHANNELS.pageImagePng, request),
  pagePreviewPng: (request) => ipcRenderer.invoke(PDF_CHANNELS.pagePreviewPng, request),
  extractPages: (request) => ipcRenderer.invoke(PDF_CHANNELS.extractPages, request),
  insertPdf: (request) => ipcRenderer.invoke(PDF_CHANNELS.insertPdf, request),
  compareReadPdf: () => ipcRenderer.invoke(PDF_CHANNELS.compareReadPdf),
  compareReadOpen: (path: string, password?: string) =>
    ipcRenderer.invoke(PDF_CHANNELS.compareReadOpen, path, password),
  reduceFileSize: (path) => ipcRenderer.invoke(PDF_CHANNELS.reduceFileSize, path),
  inspectHidden: (path) => ipcRenderer.invoke(PDF_CHANNELS.inspectHidden, path),
  removeHidden: (path, categories) =>
    ipcRenderer.invoke(PDF_CHANNELS.removeHidden, path, categories),
  insertBlankPage: (request) => ipcRenderer.invoke(PDF_CHANNELS.insertBlankPage, request),
  splitPdf: (request) => ipcRenderer.invoke(PDF_CHANNELS.splitPdf, request),
  mergePdf: (request) => ipcRenderer.invoke(PDF_CHANNELS.mergePdf, request),
  mergePages: (request) => ipcRenderer.invoke(PDF_CHANNELS.mergePages, request),
  replacePages: (request) => ipcRenderer.invoke(PDF_CHANNELS.replacePages, request),
  setPageSize: (request) => ipcRenderer.invoke(PDF_CHANNELS.setPageSize, request),
  splitPages: (request) => ipcRenderer.invoke(PDF_CHANNELS.splitPages, request),
  cropPages: (request) => ipcRenderer.invoke(PDF_CHANNELS.cropPages, request),
  exportImages: (request) => ipcRenderer.invoke(PDF_CHANNELS.exportImages, request),
  convertOffice: (format) => ipcRenderer.invoke(PDF_CHANNELS.convertOffice, format),
  createDocument: (request) => ipcRenderer.invoke(PDF_CHANNELS.createDocument, request),
  listDigitalSignatures: (path) => ipcRenderer.invoke(PDF_CHANNELS.listDigitalSignatures, path),
  pickCertificate: () => ipcRenderer.invoke(PDF_CHANNELS.pickCertificate),
  listSystemCertificates: (storePassword) =>
    ipcRenderer.invoke(PDF_CHANNELS.listSystemCertificates, storePassword),
  releaseCertificate: (certId) => ipcRenderer.send(PDF_CHANNELS.releaseCertificate, certId),
  inspectCertificate: (certId, password, storePassword) =>
    ipcRenderer.invoke(PDF_CHANNELS.inspectCertificate, certId, password, storePassword),
  signWithCertificate: (request) => ipcRenderer.invoke(PDF_CHANNELS.signWithCertificate, request),
  listSavedSignatures: () => ipcRenderer.invoke(PDF_CHANNELS.listSignatures),
  addSavedSignature: (data) => ipcRenderer.invoke(PDF_CHANNELS.addSignature, data),
  removeSavedSignature: (id) => ipcRenderer.invoke(PDF_CHANNELS.removeSignature, id),
  readPageLabels: (path) => ipcRenderer.invoke(PDF_CHANNELS.readPageLabels, path),
  signatureDisplayCopy: (path) => ipcRenderer.invoke(PDF_CHANNELS.signatureDisplayCopy, path),
  scanPage: () => ipcRenderer.invoke(PDF_CHANNELS.scanPage),
  printVector: (request) => ipcRenderer.invoke(PDF_CHANNELS.printVector, request),
  scanToPdf: (pages) => ipcRenderer.invoke(PDF_CHANNELS.scanToPdf, pages),
  trustCertificate: (fingerprint, commonName) =>
    ipcRenderer.invoke(PDF_CHANNELS.trustCertificate, fingerprint, commonName),
  untrustCertificate: (fingerprint) =>
    ipcRenderer.invoke(PDF_CHANNELS.untrustCertificate, fingerprint),
  getUsername: () => ipcRenderer.invoke(PDF_CHANNELS.getUsername),
  speechStart: (text) => ipcRenderer.invoke(PDF_CHANNELS.speechStart, text),
  speechPause: () => ipcRenderer.invoke(PDF_CHANNELS.speechPause),
  speechStop: () => ipcRenderer.invoke(PDF_CHANNELS.speechStop),
  speechState: () => ipcRenderer.invoke(PDF_CHANNELS.speechState),
  setDirty: (dirty) => ipcRenderer.send(PDF_CHANNELS.dirtyChanged, dirty),
  onCloseSaveRequest: (handler) => {
    const listener = (_e: unknown, opts?: { flushAll?: boolean }) =>
      handler({ flushAll: opts?.flushAll === true })
    ipcRenderer.on(PDF_CHANNELS.closeSaveRequest, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.closeSaveRequest, listener)
  },
  sendCloseSaveResult: (ok) => ipcRenderer.send(PDF_CHANNELS.closeSaveResult, ok),
  onSaveAsRequest: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, targetPath: string) => handler(targetPath)
    ipcRenderer.on(PDF_CHANNELS.saveAsRequest, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.saveAsRequest, listener)
  },
  sendSaveAsResult: (ok) => ipcRenderer.send(PDF_CHANNELS.saveAsResult, ok),
  onSaveAsFlow: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, inFlight: boolean) => handler(inFlight)
    ipcRenderer.on(PDF_CHANNELS.saveAsFlow, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.saveAsFlow, listener)
  },
  print: (job) => ipcRenderer.invoke(PDF_CHANNELS.print, job),
  listPrinters: () => ipcRenderer.invoke(PDF_CHANNELS.printers),
  onPrintRequest: (handler) => {
    const listener = () => handler()
    ipcRenderer.on(PDF_CHANNELS.printRequest, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.printRequest, listener)
  },
  onFileRenamed: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, newPath: string) => handler(newPath)
    ipcRenderer.on(PDF_CHANNELS.fileRenamed, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.fileRenamed, listener)
  },
  getLanguage: () => ipcRenderer.invoke(PDF_CHANNELS.getLanguage),
  onLanguageChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, lang: Lang) => handler(lang)
    ipcRenderer.on(PDF_CHANNELS.languageChanged, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.languageChanged, listener)
  },
  getTheme: () => ipcRenderer.invoke(PDF_CHANNELS.getTheme),
  onThemeChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, theme: UiTheme) => handler(theme)
    ipcRenderer.on(PDF_CHANNELS.themeChanged, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.themeChanged, listener)
  },
  onChromePressed: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('app:chrome-pressed', listener)
    return () => ipcRenderer.removeListener('app:chrome-pressed', listener)
  },
}

contextBridge.exposeInMainWorld('pdfApi', api)

// open documents dragged from the OS onto this tab as a new shell tab
installDropOpenBridge()
