/**
 * Strings for the features added after the first release: compare page ranges,
 * Read Out Loud, signature trust, page labels and scanner import. Every locale
 * spreads the English base; zh and zh-TW override it (same pattern as
 * cert-sign-strings.ts and protect-strings.ts).
 */
const extraStrings = {
  // Compare: choose which pages of each file to compare
  compareRangeThis: 'Pages in this file',
  compareRangeOther: 'Pages in the other file',
  compareRangePlaceholder: 'All, or e.g. 3-7',
  compareRangeInvalid:
    'Use pages such as 3-7 or 2,4,6. This file has {mine} pages and the other has {theirs}.',
  comparePairedPage: 'Page {page} ↔ {other}',

  // Read Out Loud
  readAloudGroup: 'Read Out Loud',
  readPage: 'Read page',
  readPageTip: 'Read the current page aloud',
  readToEnd: 'Read to end',
  readToEndTip: 'Read aloud from the current page to the end of the document',
  readPause: 'Pause',
  readResume: 'Resume',
  readStop: 'Stop',
  readPreparing: 'Getting the text to read…',
  readNoText:
    'There is no text to read here. A scanned page has none: run OCR on it first to give it a text layer.',
  readUnsupported: 'Read Out Loud uses the voice built into Windows, which is not available here.',
  readFailed: 'The Windows voice could not be started.',
} as const

const localizedExtraStrings = {
  zh: {
    compareRangeThis: '本文件的页码',
    compareRangeOther: '另一个文件的页码',
    compareRangePlaceholder: '全部，或如 3-7',
    compareRangeInvalid:
      '请输入如 3-7 或 2,4,6 的页码。本文件共 {mine} 页，另一个文件共 {theirs} 页。',
    comparePairedPage: '第 {page} 页 ↔ {other}',
    readAloudGroup: '朗读',
    readPage: '朗读本页',
    readPageTip: '朗读当前页',
    readToEnd: '朗读到末尾',
    readToEndTip: '从当前页朗读到文档末尾',
    readPause: '暂停',
    readResume: '继续',
    readStop: '停止',
    readPreparing: '正在获取要朗读的文字…',
    readNoText: '这里没有可朗读的文字。扫描页没有文字层：请先对它进行 OCR。',
    readUnsupported: '朗读使用 Windows 内置语音，此处不可用。',
    readFailed: '无法启动 Windows 语音。',
  },
  'zh-TW': {
    compareRangeThis: '本文件的頁碼',
    compareRangeOther: '另一個文件的頁碼',
    compareRangePlaceholder: '全部，或如 3-7',
    compareRangeInvalid:
      '請輸入如 3-7 或 2,4,6 的頁碼。本文件共 {mine} 頁，另一個文件共 {theirs} 頁。',
    comparePairedPage: '第 {page} 頁 ↔ {other}',
    readAloudGroup: '朗讀',
    readPage: '朗讀本頁',
    readPageTip: '朗讀目前頁面',
    readToEnd: '朗讀到結尾',
    readToEndTip: '從目前頁面朗讀到文件結尾',
    readPause: '暫停',
    readResume: '繼續',
    readStop: '停止',
    readPreparing: '正在取得要朗讀的文字…',
    readNoText: '這裡沒有可朗讀的文字。掃描頁沒有文字層：請先對它進行 OCR。',
    readUnsupported: '朗讀使用 Windows 內建語音，此處無法使用。',
    readFailed: '無法啟動 Windows 語音。',
  },
} as const

export const extraStringsFor = (lang: string) => ({
  ...extraStrings,
  ...(localizedExtraStrings[lang as keyof typeof localizedExtraStrings] ?? {}),
})
