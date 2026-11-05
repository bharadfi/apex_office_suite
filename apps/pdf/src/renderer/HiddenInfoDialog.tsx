import { useState } from 'react'
import type { ReactElement } from 'react'
import type { HiddenInfoCounts, SanitizeCategory } from '../shared/ipc'
import type { TFunc } from './i18n/locale'
import { useModalDialog } from './modal-dialog'

type Key = Parameters<TFunc>[0]

/** Categories in the order shown, with their label and the ones ticked when nothing was chosen yet */
const ROWS: { id: SanitizeCategory; label: Key; hint: Key; on: boolean }[] = [
  { id: 'metadata', label: 'hiddenMetadata', hint: 'hiddenMetadataHint', on: true },
  { id: 'attachments', label: 'hiddenAttachments', hint: 'hiddenAttachmentsHint', on: true },
  { id: 'scripts', label: 'hiddenScripts', hint: 'hiddenScriptsHint', on: true },
  { id: 'comments', label: 'hiddenComments', hint: 'hiddenCommentsHint', on: true },
  { id: 'thumbnails', label: 'hiddenThumbnails', hint: 'hiddenThumbnailsHint', on: true },
  { id: 'bookmarks', label: 'hiddenBookmarks', hint: 'hiddenBookmarksHint', on: false },
  { id: 'links', label: 'hiddenLinks', hint: 'hiddenLinksHint', on: false },
]

/**
 * Remove Hidden Information: lists what the file carries that is not on its pages, with how many of
 * each, and writes a copy without the ticked kinds. Counts come from the file itself (`counts`), so a
 * row with none is shown as such and cannot be ticked.
 */
export function HiddenInfoDialog({
  t,
  counts,
  failed,
  busy,
  onRemove,
  onClose,
}: {
  t: TFunc
  /** null while the file is being read */
  counts: HiddenInfoCounts | null
  failed: string | null
  busy: boolean
  onRemove: (categories: SanitizeCategory[]) => void
  onClose: () => void
}): ReactElement {
  const dialogRef = useModalDialog(onClose)
  const [off, setOff] = useState<ReadonlySet<SanitizeCategory>>(
    new Set(ROWS.filter((r) => !r.on).map((r) => r.id)),
  )
  const chosen = counts
    ? ROWS.filter((r) => !off.has(r.id) && counts[r.id] > 0).map((r) => r.id)
    : []
  const total = counts ? ROWS.reduce((sum, r) => sum + counts[r.id], 0) : 0
  const toggle = (id: SanitizeCategory) =>
    setOff((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="pdf-modal-mask" onClick={onClose}>
      <div
        ref={dialogRef}
        className="pdf-modal pdf-modal-wide pdf-hidden-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('hiddenInfo')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pdf-modal-title">{t('hiddenInfo')}</div>
        <div className="pdf-modal-hint">{t('hiddenInfoIntro')}</div>
        {failed && (
          <div className="pdf-compare-range-error" role="alert">
            {failed}
          </div>
        )}
        {!counts && !failed && <div className="pdf-modal-hint">{t('hiddenInfoReading')}</div>}
        {counts && total === 0 && <div className="pdf-modal-hint">{t('hiddenInfoNone')}</div>}
        {counts && (
          <div className="pdf-hidden-list" role="group">
            {ROWS.map((r) => (
              <label key={r.id} className="pdf-hidden-row">
                <input
                  type="checkbox"
                  checked={counts[r.id] > 0 && !off.has(r.id)}
                  disabled={counts[r.id] === 0 || busy}
                  onChange={() => toggle(r.id)}
                />
                <span className="pdf-hidden-text">
                  <span>{t(r.label)}</span>
                  <span className="pdf-hidden-hint">{t(r.hint)}</span>
                </span>
                <span className="pdf-hidden-count">{counts[r.id]}</span>
              </label>
            ))}
          </div>
        )}
        <div className="pdf-modal-hint">{t('hiddenInfoCopy')}</div>
        <div className="pdf-modal-actions">
          <button type="button" className="pdf-modal-btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className="pdf-modal-btn primary"
            disabled={busy || chosen.length === 0}
            onClick={() => onRemove(chosen)}
          >
            {t('hiddenInfoRemove')}
          </button>
        </div>
      </div>
    </div>
  )
}
