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
} as const

const localizedExtraStrings = {
  zh: {
    compareRangeThis: '本文件的页码',
    compareRangeOther: '另一个文件的页码',
    compareRangePlaceholder: '全部，或如 3-7',
    compareRangeInvalid:
      '请输入如 3-7 或 2,4,6 的页码。本文件共 {mine} 页，另一个文件共 {theirs} 页。',
    comparePairedPage: '第 {page} 页 ↔ {other}',
  },
  'zh-TW': {
    compareRangeThis: '本文件的頁碼',
    compareRangeOther: '另一個文件的頁碼',
    compareRangePlaceholder: '全部，或如 3-7',
    compareRangeInvalid:
      '請輸入如 3-7 或 2,4,6 的頁碼。本文件共 {mine} 頁，另一個文件共 {theirs} 頁。',
    comparePairedPage: '第 {page} 頁 ↔ {other}',
  },
} as const

export const extraStringsFor = (lang: string) => ({
  ...extraStrings,
  ...(localizedExtraStrings[lang as keyof typeof localizedExtraStrings] ?? {}),
})
