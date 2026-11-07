/**
 * .rtf → .docx import. Reads text, paragraphs, bold/italic/underline, tabs,
 * line breaks and \'hh / \uN escapes. Pictures, tables' structure, fields and
 * other destinations are not converted; they are counted in `dropped` rather
 * than approximated.
 */
import JSZip from 'jszip'

export interface RtfToDocxResult {
  docx: Uint8Array
  paragraphs: number
  dropped: number
}

interface Run {
  text: string
  b: boolean
  i: boolean
  u: boolean
  kind?: 'tab' | 'br'
}

/** destinations whose content is not body text */
const SKIP_DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'header',
  'footer',
  'headerl',
  'headerr',
  'footerl',
  'footerr',
  'listtable',
  'listoverridetable',
  'generator',
  'themedata',
  'colorschememapping',
  'latentstyles',
  'datastore',
  'rsidtbl',
  'xmlnstbl',
])
const DROPPED_DESTINATIONS = new Set(['pict', 'object', 'field', 'shp', 'shpinst', 'nonshppict'])

const WIN1252_HIGH =
  '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f' +
  '\u0090‘’“”•–—˜™š›œ\u009džŸ'

function cp1252(byte: number): string {
  if (byte >= 0x80 && byte < 0xa0) return WIN1252_HIGH[byte - 0x80]!
  return String.fromCharCode(byte)
}

const escapeXml = (text: string): string =>
  text.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))

export async function convertRtfToDocx(source: Uint8Array): Promise<RtfToDocxResult> {
  const text = Buffer.from(source).toString('latin1')
  if (!text.startsWith('{\\rtf')) throw new Error('not an RTF document')

  const paragraphs: Run[][] = [[]]
  let dropped = 0
  type State = {
    b: boolean
    i: boolean
    u: boolean
    skip: boolean
    uc: number
    countDropped: boolean
  }
  let state: State = { b: false, i: false, u: false, skip: false, uc: 1, countDropped: false }
  const stack: State[] = []
  let pendingSkipBytes = 0
  let buffer = ''

  const flush = (): void => {
    if (buffer && !state.skip) {
      paragraphs[paragraphs.length - 1]!.push({ text: buffer, b: state.b, i: state.i, u: state.u })
    }
    buffer = ''
  }
  const push = (run: Run): void => {
    flush()
    if (!state.skip) paragraphs[paragraphs.length - 1]!.push(run)
  }

  let pos = 0
  while (pos < text.length) {
    const ch = text[pos]!
    if (ch === '{') {
      flush()
      stack.push({ ...state })
      pos++
      // `{\*\dest` or `{\dest`: decide whether the group is skipped
      const dest = /^(\\\*)?\\([a-z]+)/.exec(text.slice(pos, pos + 40))
      if (dest) {
        const name = dest[2]!
        if (dest[1] || SKIP_DESTINATIONS.has(name) || DROPPED_DESTINATIONS.has(name)) {
          if (!state.skip && (DROPPED_DESTINATIONS.has(name) || dest[1])) dropped++
          state.skip = true
        }
      }
    } else if (ch === '}') {
      flush()
      state = stack.pop() ?? state
      pos++
    } else if (ch === '\\') {
      const next = text[pos + 1]
      if (next === undefined) break
      if (next === '\\' || next === '{' || next === '}') {
        if (!state.skip) buffer += next
        pos += 2
      } else if (next === "'") {
        const hex = text.slice(pos + 2, pos + 4)
        if (pendingSkipBytes > 0) pendingSkipBytes--
        else if (!state.skip) buffer += cp1252(parseInt(hex, 16))
        pos += 4
      } else if (next === '~') {
        if (!state.skip) buffer += ' '
        pos += 2
      } else if (next === '-' || next === '_') {
        if (!state.skip) buffer += next === '_' ? '‑' : ''
        pos += 2
      } else if (next === '*') {
        pos += 2
      } else if (/[a-zA-Z]/.test(next)) {
        const m = /^\\([a-zA-Z]+)(-?\d+)?\s?/.exec(text.slice(pos, pos + 40))!
        pos += m[0].length
        const word = m[1]!
        const param = m[2] === undefined ? undefined : Number(m[2])
        switch (word) {
          case 'par':
          case 'sect':
            flush()
            paragraphs.push([])
            break
          case 'pard':
            break
          case 'line':
            push({ text: '', b: false, i: false, u: false, kind: 'br' })
            break
          case 'tab':
            push({ text: '', b: false, i: false, u: false, kind: 'tab' })
            break
          case 'b':
            flush()
            state.b = param !== 0
            break
          case 'i':
            flush()
            state.i = param !== 0
            break
          case 'ul':
            flush()
            state.u = param !== 0
            break
          case 'ulnone':
            flush()
            state.u = false
            break
          case 'plain':
            flush()
            state.b = state.i = state.u = false
            break
          case 'uc':
            state.uc = param ?? 1
            break
          case 'u': {
            if (!state.skip && param !== undefined) {
              buffer += String.fromCharCode(param < 0 ? param + 65536 : param)
            }
            pendingSkipBytes = state.uc
            break
          }
          case 'endash':
            if (!state.skip) buffer += '–'
            break
          case 'emdash':
            if (!state.skip) buffer += '—'
            break
          case 'bullet':
            if (!state.skip) buffer += '•'
            break
          case 'lquote':
            if (!state.skip) buffer += '‘'
            break
          case 'rquote':
            if (!state.skip) buffer += '’'
            break
          case 'ldblquote':
            if (!state.skip) buffer += '“'
            break
          case 'rdblquote':
            if (!state.skip) buffer += '”'
            break
          case 'trowd':
          case 'cell':
          case 'row':
            if (word === 'cell' && !state.skip) buffer += ' '
            if (word === 'trowd') dropped++
            if (word === 'row') {
              flush()
              paragraphs.push([])
            }
            break
          default:
            break
        }
      } else {
        pos += 2
      }
    } else if (ch === '\r' || ch === '\n') {
      pos++
    } else {
      if (pendingSkipBytes > 0) pendingSkipBytes--
      else if (!state.skip) buffer += ch
      pos++
    }
  }
  flush()

  while (paragraphs.length > 1 && paragraphs[paragraphs.length - 1]!.length === 0) paragraphs.pop()
  const body = paragraphs
    .map((runs) => {
      const inner = runs
        .map((run) => {
          if (run.kind === 'br') return '<w:r><w:br/></w:r>'
          if (run.kind === 'tab') return '<w:r><w:tab/></w:r>'
          const props =
            (run.b ? '<w:b/>' : '') + (run.i ? '<w:i/>' : '') + (run.u ? '<w:u w:val="single"/>' : '')
          return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(run.text)}</w:t></w:r>`
        })
        .join('')
      return `<w:p>${inner}</w:p>`
    })
    .join('')

  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  )
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body>${body}</w:body></w:document>`,
  )
  const docx = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  return { docx, paragraphs: paragraphs.length, dropped }
}
