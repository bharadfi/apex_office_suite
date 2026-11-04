import { useState } from 'react'
import type { ReactElement } from 'react'
import {
  PAGE_LABEL_STYLES,
  labelsFor,
  normalizeRanges,
  type PageLabelRange,
  type PageLabelStyle,
} from '../shared/page-labels'
import type { TFunc } from './i18n/locale'
import { useModalDialog } from './modal-dialog'

type Key = Parameters<TFunc>[0]

const STYLE_KEYS: Record<PageLabelStyle, Key> = {
  decimal: 'pageLabelStyleDecimal',
  lowerRoman: 'pageLabelStyleLowerRoman',
  upperRoman: 'pageLabelStyleUpperRoman',
  lowerAlpha: 'pageLabelStyleLowerAlpha',
  upperAlpha: 'pageLabelStyleUpperAlpha',
  none: 'pageLabelStyleNone',
}

/** A row as typed: numbers stay text until they are checked, so a half-typed value is not lost */
interface Row {
  id: number
  from: string
  style: PageLabelStyle
  prefix: string
  first: string
}

const isWhole = (text: string, min: number, max: number): boolean =>
  /^\d+$/.test(text.trim()) && Number(text) >= min && Number(text) <= max

/** The rows as ranges (zero-based starts), or null while any row is not valid yet */
export function rowsToRanges(rows: readonly Row[], pageCount: number): PageLabelRange[] | null {
  const out: PageLabelRange[] = []
  for (const row of rows) {
    if (!isWhole(row.from, 1, pageCount) || !isWhole(row.first, 1, 999_999)) return null
    out.push({
      start: Number(row.from) - 1,
      style: row.style,
      prefix: row.prefix,
      firstNumber: Number(row.first),
    })
  }
  return normalizeRanges(out)
}

const PREVIEW_PAGES = 12

/**
 * Edit how pages are numbered: runs of pages, each with a style, an optional prefix and a first
 * number. Applying makes the labels a pending edit of the open document (undoable, written on
 * save); "Remove all labels" makes the document carry none.
 */
export function PageLabelsDialog({
  t,
  pageCount,
  initial,
  onApply,
  onClose,
}: {
  t: TFunc
  pageCount: number
  /** the labels in force now: [] when the pages are numbered plainly */
  initial: readonly PageLabelRange[]
  onApply: (ranges: PageLabelRange[]) => void
  onClose: () => void
}): ReactElement {
  const dialogRef = useModalDialog(onClose)
  const [nextId, setNextId] = useState(initial.length + 1)
  const [rows, setRows] = useState<Row[]>(() =>
    (initial.length > 0
      ? initial
      : [{ start: 0, style: 'decimal' as const, prefix: '', firstNumber: 1 }]
    ).map((range, i) => ({
      id: i,
      from: String(range.start + 1),
      style: range.style,
      prefix: range.prefix,
      first: String(range.firstNumber),
    })),
  )
  const ranges = rowsToRanges(rows, pageCount)
  const change = (id: number, patch: Partial<Row>): void =>
    setRows((list) => list.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  const add = (): void => {
    const last = Math.max(
      0,
      ...rows.map((row) => (isWhole(row.from, 1, pageCount) ? Number(row.from) : 0)),
    )
    setRows((list) => [
      ...list,
      {
        id: nextId,
        from: String(Math.min(pageCount, last + 1)),
        style: 'decimal',
        prefix: '',
        first: '1',
      },
    ])
    setNextId(nextId + 1)
  }
  const preview = ranges ? labelsFor(ranges, Math.min(pageCount, PREVIEW_PAGES)) : []

  return (
    <div className="pdf-modal-mask" onClick={onClose}>
      <div
        ref={dialogRef}
        className="pdf-modal pdf-modal-wide pdf-labels-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('pageLabels')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pdf-modal-title">{t('pageLabels')}</div>
        <div className="pdf-modal-hint">{t('pageLabelsIntro')}</div>
        <div className="pdf-labels-grid" role="group">
          <span className="pdf-labels-head">{t('pageLabelsStartAt')}</span>
          <span className="pdf-labels-head">{t('pageLabelsStyle')}</span>
          <span className="pdf-labels-head">{t('pageLabelsPrefix')}</span>
          <span className="pdf-labels-head">{t('pageLabelsFirst')}</span>
          <span />
          {rows.map((row) => (
            <div className="pdf-labels-row" key={row.id} role="group">
              <input
                type="text"
                inputMode="numeric"
                aria-label={t('pageLabelsStartAt')}
                value={row.from}
                aria-invalid={!isWhole(row.from, 1, pageCount)}
                onChange={(e) => change(row.id, { from: e.target.value })}
              />
              <select
                aria-label={t('pageLabelsStyle')}
                value={row.style}
                onChange={(e) => change(row.id, { style: e.target.value as PageLabelStyle })}
              >
                {PAGE_LABEL_STYLES.map((style) => (
                  <option key={style} value={style}>
                    {t(STYLE_KEYS[style])}
                  </option>
                ))}
              </select>
              <input
                type="text"
                aria-label={t('pageLabelsPrefix')}
                value={row.prefix}
                onChange={(e) => change(row.id, { prefix: e.target.value })}
              />
              <input
                type="text"
                inputMode="numeric"
                aria-label={t('pageLabelsFirst')}
                value={row.first}
                disabled={row.style === 'none'}
                aria-invalid={!isWhole(row.first, 1, 999_999)}
                onChange={(e) => change(row.id, { first: e.target.value })}
              />
              <button
                type="button"
                className="rb-icon"
                aria-label={t('pageLabelsRemoveRange')}
                data-tip={t('pageLabelsRemoveRange')}
                disabled={rows.length === 1}
                onClick={() => setRows((list) => list.filter((r) => r.id !== row.id))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="pdf-modal-btn" onClick={add}>
          {t('pageLabelsAddRange')}
        </button>
        {ranges === null ? (
          <div className="pdf-compare-range-error" role="alert">
            {t('pageLabelsInvalid', { count: pageCount })}
          </div>
        ) : (
          <div className="pdf-labels-preview">
            <span>{t('pageLabelsPreview')}</span>
            <strong>
              {preview.join(', ')}
              {pageCount > PREVIEW_PAGES ? ' …' : ''}
            </strong>
          </div>
        )}
        <div className="pdf-modal-actions">
          <button type="button" className="pdf-modal-btn" onClick={() => onApply([])}>
            {t('pageLabelsRemoveAll')}
          </button>
          <button type="button" className="pdf-modal-btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className="pdf-modal-btn primary"
            disabled={ranges === null}
            onClick={() => ranges && onApply(ranges)}
          >
            {t('pageLabelsApply')}
          </button>
        </div>
      </div>
    </div>
  )
}
