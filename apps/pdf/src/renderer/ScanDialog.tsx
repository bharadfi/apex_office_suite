import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { ScanResult } from '../shared/ipc'
import type { TFunc } from './i18n/locale'
import { useModalDialog } from './modal-dialog'

interface ScannedPage {
  id: number
  bytes: Uint8Array
  /** object URL of the picture, for the little preview */
  url: string
}

type Key = Parameters<TFunc>[0]

/** What to tell the user about a scan that brought no picture; null when nothing needs saying (they just closed the window) */
export function scanProblemKey(result: Extract<ScanResult, { ok: false }>): Key | null {
  switch (result.reason) {
    case 'cancelled':
      return null
    case 'no-scanner':
      return 'scanNoScanner'
    case 'busy':
      return 'scanBusy'
    case 'unsupported':
      return 'scanUnsupported'
    case 'failed':
      return 'scanFailed'
  }
}

/**
 * Scan pages into a new PDF. Each scan opens Windows' own scan window; the picture it brings
 * back becomes the next page. "Create PDF" writes them as one new document and opens it.
 */
export function ScanDialog({ t, onClose }: { t: TFunc; onClose: () => void }): ReactElement {
  const dialogRef = useModalDialog(onClose)
  const [pages, setPages] = useState<ScannedPage[]>([])
  const [scanning, setScanning] = useState(false)
  const [creating, setCreating] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const nextId = useRef(1)
  /** every preview URL ever made, so closing the dialog frees them all */
  const urls = useRef(new Set<string>())

  useEffect(() => {
    const made = urls.current
    return () => {
      for (const url of made) URL.revokeObjectURL(url)
    }
  }, [])

  const scan = async (): Promise<void> => {
    setProblem(null)
    setScanning(true)
    try {
      const result = await window.pdfApi.scanPage()
      if (result.ok) {
        const url = URL.createObjectURL(new Blob([result.png as BlobPart], { type: 'image/png' }))
        urls.current.add(url)
        setPages((list) => [...list, { id: nextId.current++, bytes: result.png, url }])
        return
      }
      const key = scanProblemKey(result)
      if (key) {
        setProblem(result.detail && key === 'scanFailed' ? `${t(key)} ${result.detail}` : t(key))
      }
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err))
    } finally {
      setScanning(false)
    }
  }

  const create = async (): Promise<void> => {
    setProblem(null)
    setCreating(true)
    try {
      const result = await window.pdfApi.scanToPdf(pages.map((page) => page.bytes))
      if (result.ok) onClose()
      else setProblem(`${t('scanCreateFailed')} ${result.error}`)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  const busy = scanning || creating
  return (
    <div className="pdf-modal-mask" onClick={onClose}>
      <div
        ref={dialogRef}
        className="pdf-modal pdf-modal-wide pdf-scan-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('scanToPdf')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pdf-modal-title">{t('scanToPdf')}</div>
        <div className="pdf-modal-hint">{t('scanIntro')}</div>
        {pages.length > 0 && (
          <ol className="pdf-scan-pages" aria-label={t('scanPagesLabel', { count: pages.length })}>
            {pages.map((page, i) => (
              <li key={page.id} className="pdf-scan-page">
                <img src={page.url} alt={t('scanPageAlt', { n: i + 1 })} />
                <span>{i + 1}</span>
                <button
                  type="button"
                  className="rb-icon"
                  aria-label={t('scanRemovePage', { n: i + 1 })}
                  data-tip={t('scanRemovePage', { n: i + 1 })}
                  disabled={busy}
                  onClick={() => setPages((list) => list.filter((p) => p.id !== page.id))}
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
        )}
        {scanning && (
          <div className="pdf-modal-hint" role="status">
            {t('scanWaiting')}
          </div>
        )}
        {problem && (
          <div className="pdf-compare-range-error" role="alert">
            {problem}
          </div>
        )}
        <div className="pdf-modal-actions">
          <button
            type="button"
            className="pdf-modal-btn"
            disabled={busy}
            onClick={() => void scan()}
          >
            {pages.length === 0 ? t('scanAPage') : t('scanAnother')}
          </button>
          <button type="button" className="pdf-modal-btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className="pdf-modal-btn primary"
            disabled={busy || pages.length === 0}
            onClick={() => void create()}
          >
            {creating ? t('scanCreating') : t('scanCreate')}
          </button>
        </div>
      </div>
    </div>
  )
}
