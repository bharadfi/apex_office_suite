import type { ReactElement } from 'react'
import type { AccessibilityCheck } from '../shared/ipc'
import type { TFunc } from './i18n/locale'
import { useModalDialog } from './modal-dialog'

type Key = Parameters<TFunc>[0]

const LABELS: Record<AccessibilityCheck['id'], { label: Key; fix: Key }> = {
  tagged: { label: 'a11yTagged', fix: 'a11yTaggedFix' },
  language: { label: 'a11yLanguage', fix: 'a11yLanguageFix' },
  title: { label: 'a11yTitle', fix: 'a11yTitleFix' },
  figureAlt: { label: 'a11yFigureAlt', fix: 'a11yFigureAltFix' },
  fieldTips: { label: 'a11yFieldTips', fix: 'a11yFieldTipsFix' },
  tabOrder: { label: 'a11yTabOrder', fix: 'a11yTabOrderFix' },
  bookmarks: { label: 'a11yBookmarks', fix: 'a11yBookmarksFix' },
  screenReaderAccess: { label: 'a11yScreenReader', fix: 'a11yScreenReaderFix' },
}

/** Accessibility check: what assistive software can read in the file, one row per check */
export function AccessibilityDialog({
  t,
  checks,
  failed,
  onClose,
}: {
  t: TFunc
  /** null while the file is being read */
  checks: AccessibilityCheck[] | null
  failed: string | null
  onClose: () => void
}): ReactElement {
  const dialogRef = useModalDialog(onClose)
  const problems = checks?.filter((c) => c.status === 'fail').length ?? 0
  return (
    <div className="pdf-modal-mask" onClick={onClose}>
      <div
        ref={dialogRef}
        className="pdf-modal pdf-modal-wide pdf-a11y-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('a11yCheck')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pdf-modal-title">{t('a11yCheck')}</div>
        {failed && (
          <div className="pdf-compare-range-error" role="alert">
            {failed}
          </div>
        )}
        {!checks && !failed && <div className="pdf-modal-hint">{t('hiddenInfoReading')}</div>}
        {checks && (
          <div className="pdf-modal-hint" role="status">
            {problems === 0 ? t('a11yAllPassed') : t('a11yProblems', { count: problems })}
          </div>
        )}
        {checks && (
          <ul className="pdf-a11y-list">
            {checks.map((c) => (
              <li key={c.id} className={`pdf-a11y-row is-${c.status}`}>
                <span className="pdf-a11y-mark" aria-hidden="true">
                  {c.status === 'pass' ? '✓' : '✕'}
                </span>
                <span className="pdf-hidden-text">
                  <span>
                    {t(LABELS[c.id].label)}
                    {c.status === 'fail' && c.count > 0 ? ` (${c.count})` : ''}
                    <span className="pdf-a11y-state">
                      {' '}
                      {c.status === 'pass' ? t('a11yPassed') : t('a11yFailed')}
                    </span>
                  </span>
                  {c.status === 'fail' && (
                    <span className="pdf-hidden-hint">{t(LABELS[c.id].fix)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="pdf-modal-hint">{t('a11yNotTested')}</div>
        <div className="pdf-modal-actions">
          <button type="button" className="pdf-modal-btn primary" onClick={onClose}>
            {t('ok')}
          </button>
        </div>
      </div>
    </div>
  )
}
