import type { TFunc } from './i18n/locale'
import type { CompareResult } from './compare-text'

/**
 * View → Compare: the open document against a picked one. Pages pair up by
 * position within the chosen pages (all pages unless a range is typed). Read-only
 * — rows jump to the page in the open document, nothing here touches the file.
 */
export function ComparePanel({
  t,
  result,
  otherName,
  busy,
  onPick,
  onSwap,
  onGoToPage,
  ranges,
}: {
  t: TFunc
  result: CompareResult | null
  otherName: string | null
  busy: boolean
  onPick: () => void
  /** treat the picked document as the old side instead of the new one */
  onSwap: () => void
  onGoToPage: (pageIndex: number) => void
  /** page choices; absent until a second document is loaded */
  ranges?: {
    mine: string
    theirs: string
    onChange: (which: 'mine' | 'theirs', value: string) => void
    /** the typed text is not a valid selection (the last valid result stays) */
    invalid: { mine: number; theirs: number } | null
  }
}): React.JSX.Element {
  const differing = result?.pages.filter((p) => p.addedCount > 0 || p.removedCount > 0) ?? []
  return (
    <div className="pdf-compare">
      <button
        type="button"
        className="pdf-modal-btn primary pdf-compare-pick"
        onClick={onPick}
        disabled={busy}
      >
        {busy ? t('loading') : t('comparePick')}
      </button>
      {otherName && (
        <button type="button" className="pdf-compare-swap" onClick={onSwap}>
          {t('compareSwap')}
        </button>
      )}
      {ranges && (
        <div className="pdf-compare-ranges">
          <label className="pdf-compare-range">
            <span>{t('compareRangeThis')}</span>
            <input
              type="text"
              value={ranges.mine}
              placeholder={t('compareRangePlaceholder')}
              aria-invalid={ranges.invalid !== null}
              onChange={(e) => ranges.onChange('mine', e.target.value)}
            />
          </label>
          <label className="pdf-compare-range">
            <span>{t('compareRangeOther')}</span>
            <input
              type="text"
              value={ranges.theirs}
              placeholder={t('compareRangePlaceholder')}
              aria-invalid={ranges.invalid !== null}
              onChange={(e) => ranges.onChange('theirs', e.target.value)}
            />
          </label>
          {ranges.invalid && (
            <div className="pdf-compare-range-error" role="alert">
              {t('compareRangeInvalid', {
                mine: ranges.invalid.mine,
                theirs: ranges.invalid.theirs,
              })}
            </div>
          )}
        </div>
      )}
      {result && (
        <div className="pdf-modal-hint">
          {result.equal
            ? t('compareIdentical')
            : t('compareDiffPages', { count: differing.length })}
          {otherName && <div className="pdf-compare-other">{otherName}</div>}
        </div>
      )}
      <ul className="pdf-compare-list">
        {differing.map((page, row) => (
          // by row, not page: with chosen pages several rows can name the same open page
          <li key={row}>
            <button
              type="button"
              className="pdf-compare-row"
              onClick={() => onGoToPage(page.pageIndex + 1)}
            >
              <span className="pdf-compare-page">
                {page.otherPageIndex !== undefined && page.otherPageIndex !== page.pageIndex
                  ? t('comparePairedPage', {
                      page: page.pageIndex + 1,
                      other: page.otherPageIndex + 1,
                    })
                  : t('comparePage', { page: page.pageIndex + 1 })}
              </span>
              {page.truncated ? (
                <span className="pdf-compare-truncated">{t('compareTruncated')}</span>
              ) : (
                <>
                  {page.addedCount > 0 && (
                    <span className="pdf-compare-added">
                      {t('compareAdded', { count: page.addedCount })}
                    </span>
                  )}
                  {page.removedCount > 0 && (
                    <span className="pdf-compare-removed">
                      {t('compareRemoved', { count: page.removedCount })}
                    </span>
                  )}
                </>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
