/**
 * Page-aligned text comparison between two documents. Pages pair up by index;
 * a document with more pages has its extras fully added (or removed). The
 * per-page line diff is an LCS over normalized lines, with a size cap: past it
 * the page reports as wholesale-changed with a `truncated` flag instead of
 * burning quadratic time on a diff nobody reads line by line.
 */

export interface PageText {
  pageIndex: number
  text: string
}

export interface DiffLine {
  line: string
  /** the line's index in that side's normalized page */
  index: number
}

export interface PageDiff {
  pageIndex: number
  added: DiffLine[]
  removed: DiffLine[]
  addedCount: number
  removedCount: number
  /** the size cap hit: only the counts are meaningful, not the listed lines */
  truncated?: boolean
  /**
   * Set when only some pages were compared: the page of the OTHER document this
   * row was paired with (zero-based). `pageIndex` then names the open document's
   * page, not the position within the chosen pages.
   */
  otherPageIndex?: number
}

export interface CompareResult {
  pages: PageDiff[]
  equal: boolean
}

const MAX_DIFF_LINES = 4000

/** lines, trimmed, internal whitespace collapsed, blanks dropped */
export function normalizePageText(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
}

interface Keep {
  text: string
  aIndex: number
  bIndex: number
}

/** longest common subsequence as kept-line triplets, monotonic in both sides */
function lcs(a: string[], b: string[]): Keep[] {
  const rows = a.length
  const cols = b.length
  const width = cols + 1
  const table = new Int32Array((rows + 1) * width)
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!)
    }
  }
  const out: Keep[] = []
  let i = 0
  let j = 0
  while (i < rows && j < cols) {
    if (a[i] === b[j]) {
      out.push({ text: a[i]!, aIndex: i, bIndex: j })
      i++
      j++
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      i++
    } else {
      j++
    }
  }
  return out
}

export function diffLines(a: string[], b: string[]): { added: DiffLine[]; removed: DiffLine[] } {
  const kept = lcs(a, b)
  const added: DiffLine[] = []
  const removed: DiffLine[] = []
  let ai = 0
  let bi = 0
  for (const keep of kept) {
    while (ai < keep.aIndex) removed.push({ line: a[ai++]!, index: ai - 1 })
    while (bi < keep.bIndex) added.push({ line: b[bi++]!, index: bi - 1 })
    ai++
    bi++
  }
  while (ai < a.length) removed.push({ line: a[ai++]!, index: ai - 1 })
  while (bi < b.length) added.push({ line: b[bi++]!, index: bi - 1 })
  return { added, removed }
}

/** pages pair by index; extras on the longer side are wholly added or removed */
export function compareDocuments(left: PageText[], right: PageText[]): CompareResult {
  const pages: PageDiff[] = []
  const count = Math.max(left.length, right.length)
  for (let i = 0; i < count; i++) {
    const a = left[i]
    const b = right[i]
    if (!a) {
      const lines = normalizePageText(b!.text)
      pages.push({
        pageIndex: i,
        added: lines.map((line, index) => ({ line, index })),
        removed: [],
        addedCount: lines.length,
        removedCount: 0,
      })
      continue
    }
    if (!b) {
      const lines = normalizePageText(a.text)
      pages.push({
        pageIndex: i,
        added: [],
        removed: lines.map((line, index) => ({ line, index })),
        addedCount: 0,
        removedCount: lines.length,
      })
      continue
    }
    const na = normalizePageText(a.text)
    const nb = normalizePageText(b.text)
    if (na.length > MAX_DIFF_LINES || nb.length > MAX_DIFF_LINES) {
      const identical = na.length === nb.length && na.every((line, k) => line === nb[k])
      if (identical) {
        pages.push({ pageIndex: i, added: [], removed: [], addedCount: 0, removedCount: 0 })
      } else {
        pages.push({
          pageIndex: i,
          added: [],
          removed: [],
          addedCount: nb.length,
          removedCount: na.length,
          truncated: true,
        })
      }
      continue
    }
    const { added, removed } = diffLines(na, nb)
    pages.push({
      pageIndex: i,
      added,
      removed,
      addedCount: added.length,
      removedCount: removed.length,
    })
  }
  return {
    pages,
    equal: pages.every((p) => p.addedCount === 0 && p.removedCount === 0),
  }
}

/**
 * A page selection such as "3-7", "5" or "2,4-6" as zero-based page indexes in
 * the order written (so "6-4" reads backwards and "1,1" repeats a page, which
 * is what a person typing it means). A blank selection means every page.
 * Returns null when the text is not a selection or names a page outside 1..count.
 */
export function parsePageSelection(input: string, count: number): number[] | null {
  const text = input.trim()
  if (text === '') return Array.from({ length: count }, (_, i) => i)
  const out: number[] = []
  for (const part of text.split(',')) {
    const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+)\s*)?$/.exec(part)
    if (!m) return null
    const from = Number(m[1])
    const to = m[2] === undefined ? from : Number(m[2])
    if (from < 1 || to < 1 || from > count || to > count) return null
    const step = from <= to ? 1 : -1
    for (let n = from; n !== to + step; n += step) out.push(n - 1)
  }
  return out
}

/**
 * Compare chosen pages of two documents: the k-th chosen page of one pairs with
 * the k-th chosen page of the other. Rows come back numbered by the OPEN
 * document's pages (`mine`), each carrying the page it was paired with in the
 * other (`otherPageIndex`), so "go to page" still lands in the open document.
 */
export function compareSelected(
  mine: PageText[],
  mineSelection: number[],
  theirs: PageText[],
  theirSelection: number[],
  swapped: boolean,
): CompareResult {
  const pick = (all: PageText[], selection: number[]): PageText[] =>
    selection.map((index, position) => ({ pageIndex: position, text: all[index]?.text ?? '' }))
  const mineSide = pick(mine, mineSelection)
  const theirSide = pick(theirs, theirSelection)
  const raw = swapped
    ? compareDocuments(theirSide, mineSide)
    : compareDocuments(mineSide, theirSide)
  const last = mineSelection[mineSelection.length - 1] ?? 0
  return {
    equal: raw.equal,
    pages: raw.pages.map((page) => ({
      ...page,
      pageIndex: mineSelection[page.pageIndex] ?? last,
      otherPageIndex: theirSelection[page.pageIndex] ?? theirSelection[theirSelection.length - 1],
    })),
  }
}
