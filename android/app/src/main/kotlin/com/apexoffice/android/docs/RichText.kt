package com.apexoffice.android.docs

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.text.Editable
import android.text.Layout
import android.text.Spannable
import android.text.Spanned
import android.text.TextPaint
import android.text.style.AlignmentSpan
import android.text.style.BackgroundColorSpan
import android.text.style.BulletSpan
import android.text.style.CharacterStyle
import android.text.style.ForegroundColorSpan
import android.text.style.MetricAffectingSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.UnderlineSpan
import android.text.style.AbsoluteSizeSpan

/** A document heading (level 1-3): larger and bold, and written back as a Word heading style. */
class HeadingSpan(val level: Int) : MetricAffectingSpan() {
    private val scale = when (level) { 1 -> 1.8f; 2 -> 1.5f; else -> 1.25f }
    override fun updateDrawState(tp: TextPaint) = apply(tp)
    override fun updateMeasureState(tp: TextPaint) = apply(tp)
    private fun apply(tp: TextPaint) {
        tp.textSize = tp.textSize * scale
        tp.typeface = Typeface.create(tp.typeface, Typeface.BOLD)
    }
}

/** A numbered-list paragraph: draws its position in the run of numbered paragraphs (1., 2., ...). */
class NumberSpan : android.text.style.LeadingMarginSpan {
    override fun getLeadingMargin(first: Boolean) = 72
    override fun drawLeadingMargin(
        c: Canvas, p: Paint, x: Int, dir: Int, top: Int, baseline: Int, bottom: Int,
        text: CharSequence, start: Int, end: Int, first: Boolean, layout: Layout?,
    ) {
        if (!first) return
        val spanned = text as? Spanned ?: return
        var n = 1
        var s = start
        while (s > 0) {
            val newline = s - 1
            var ps = newline
            while (ps > 0 && text[ps - 1] != '\n') ps--
            if (spanned.getSpans(ps, maxOf(newline, ps), NumberSpan::class.java).isEmpty()) break
            n++
            s = ps
        }
        c.drawText("$n.", x + dir * 6f, baseline.toFloat(), p)
    }
}

/** Points in a Word file map to display sp so an 11 pt body reads as 16 sp. */
const val PT_TO_SP = 16f / 11f

enum class CharStyle { BOLD, ITALIC, UNDERLINE, STRIKE }

object RichText {
    fun paragraphRange(text: CharSequence, start: Int, end: Int): Pair<Int, Int> {
        var s = start.coerceIn(0, text.length)
        while (s > 0 && text[s - 1] != '\n') s--
        var e = end.coerceIn(0, text.length)
        while (e < text.length && text[e] != '\n') e++
        return s to e
    }

    private fun matches(span: Any, style: CharStyle): Boolean = when (style) {
        CharStyle.BOLD -> span is StyleSpan && span.style and Typeface.BOLD != 0
        CharStyle.ITALIC -> span is StyleSpan && span.style and Typeface.ITALIC != 0
        CharStyle.UNDERLINE -> span is UnderlineSpan
        CharStyle.STRIKE -> span is StrikethroughSpan
    }

    private fun make(style: CharStyle): Any = when (style) {
        CharStyle.BOLD -> StyleSpan(Typeface.BOLD)
        CharStyle.ITALIC -> StyleSpan(Typeface.ITALIC)
        CharStyle.UNDERLINE -> UnderlineSpan()
        CharStyle.STRIKE -> StrikethroughSpan()
    }

    /** True when every character in [start, end) already has [style]. */
    fun covered(text: Spanned, start: Int, end: Int, style: CharStyle): Boolean {
        if (end <= start) {
            val at = (start - 1).coerceAtLeast(0)
            return text.getSpans(at, (at + 1).coerceAtMost(text.length), Any::class.java).any { matches(it, style) && text.getSpanStart(it) <= at && text.getSpanEnd(it) > at }
        }
        val covers = BooleanArray(end - start)
        for (span in text.getSpans(start, end, Any::class.java)) {
            if (!matches(span, style)) continue
            for (i in maxOf(start, text.getSpanStart(span)) until minOf(end, text.getSpanEnd(span))) covers[i - start] = true
        }
        return covers.all { it }
    }

    /** Removes [style] from [start, end), keeping it on the parts of overlapping spans outside the range. */
    fun clear(text: Editable, start: Int, end: Int, style: CharStyle) {
        for (span in text.getSpans(start, end, Any::class.java)) {
            if (!matches(span, style)) continue
            val s = text.getSpanStart(span)
            val e = text.getSpanEnd(span)
            text.removeSpan(span)
            if (s < start) text.setSpan(make(style), s, start, Spanned.SPAN_EXCLUSIVE_INCLUSIVE)
            if (e > end) text.setSpan(make(style), end, e, Spanned.SPAN_EXCLUSIVE_INCLUSIVE)
        }
    }

    fun toggle(text: Editable, start: Int, end: Int, style: CharStyle): Boolean {
        if (end <= start) return false
        val on = !covered(text, start, end, style)
        clear(text, start, end, style)
        if (on) text.setSpan(make(style), start, end, Spanned.SPAN_EXCLUSIVE_INCLUSIVE)
        return on
    }

    fun setSize(text: Editable, start: Int, end: Int, sizeSp: Int) {
        for (span in text.getSpans(start, end, AbsoluteSizeSpan::class.java)) {
            val s = text.getSpanStart(span)
            val e = text.getSpanEnd(span)
            text.removeSpan(span)
            if (s < start) text.setSpan(AbsoluteSizeSpan(span.size, span.dip), s, start, Spanned.SPAN_EXCLUSIVE_INCLUSIVE)
            if (e > end) text.setSpan(AbsoluteSizeSpan(span.size, span.dip), end, e, Spanned.SPAN_EXCLUSIVE_INCLUSIVE)
        }
        text.setSpan(AbsoluteSizeSpan(sizeSp, true), start, end, Spanned.SPAN_EXCLUSIVE_INCLUSIVE)
    }

    fun sizeAt(text: Spanned, pos: Int, default: Int = 16): Int =
        text.getSpans((pos - 1).coerceAtLeast(0), pos.coerceAtMost(text.length).coerceAtLeast(1), AbsoluteSizeSpan::class.java)
            .firstOrNull()?.size ?: default

    fun setColor(text: Editable, start: Int, end: Int, color: Int?) {
        for (span in text.getSpans(start, end, ForegroundColorSpan::class.java)) {
            val s = text.getSpanStart(span)
            val e = text.getSpanEnd(span)
            text.removeSpan(span)
            if (s < start) text.setSpan(ForegroundColorSpan(span.foregroundColor), s, start, Spanned.SPAN_EXCLUSIVE_INCLUSIVE)
            if (e > end) text.setSpan(ForegroundColorSpan(span.foregroundColor), end, e, Spanned.SPAN_EXCLUSIVE_INCLUSIVE)
        }
        if (color != null) text.setSpan(ForegroundColorSpan(color), start, end, Spanned.SPAN_EXCLUSIVE_INCLUSIVE)
    }

    fun setHeading(text: Editable, start: Int, end: Int, level: Int) {
        val (ps, pe) = paragraphRange(text, start, end)
        for (span in text.getSpans(ps, pe, HeadingSpan::class.java)) text.removeSpan(span)
        if (level in 1..3) text.setSpan(HeadingSpan(level), ps, pe, Spanned.SPAN_EXCLUSIVE_INCLUSIVE)
    }

    fun headingAt(text: Spanned, pos: Int): Int {
        val (ps, pe) = paragraphRange(text, pos, pos)
        return text.getSpans(ps, maxOf(pe, ps), HeadingSpan::class.java).firstOrNull()?.level ?: 0
    }

    fun setAlignment(text: Editable, start: Int, end: Int, alignment: Layout.Alignment) {
        val (ps, pe) = paragraphRange(text, start, end)
        for (span in text.getSpans(ps, pe, AlignmentSpan::class.java)) text.removeSpan(span)
        if (alignment != Layout.Alignment.ALIGN_NORMAL) {
            text.setSpan(AlignmentSpan.Standard(alignment), ps, if (pe < text.length) pe + 1 else pe, Spanned.SPAN_PARAGRAPH)
        }
    }

    fun alignmentAt(text: Spanned, pos: Int): Layout.Alignment {
        val (ps, pe) = paragraphRange(text, pos, pos)
        return text.getSpans(ps, maxOf(pe, ps), AlignmentSpan::class.java).firstOrNull()?.alignment ?: Layout.Alignment.ALIGN_NORMAL
    }

    fun isBullet(text: Spanned, pos: Int): Boolean {
        val (ps, pe) = paragraphRange(text, pos, pos)
        return text.getSpans(ps, maxOf(pe, ps), BulletSpan::class.java).isNotEmpty()
    }

    fun isNumbered(text: Spanned, pos: Int): Boolean {
        val (ps, pe) = paragraphRange(text, pos, pos)
        return text.getSpans(ps, maxOf(pe, ps), NumberSpan::class.java).isNotEmpty()
    }

    fun toggleNumbered(text: Editable, start: Int, end: Int) {
        val (ps, pe) = paragraphRange(text, start, end)
        val on = text.getSpans(ps, pe, NumberSpan::class.java).isEmpty()
        var cursor = ps
        while (cursor <= pe) {
            val (qs, qe) = paragraphRange(text, cursor, cursor)
            val whole = if (qe < text.length) qe + 1 else qe
            for (span in text.getSpans(qs, maxOf(qe, qs), NumberSpan::class.java)) text.removeSpan(span)
            for (span in text.getSpans(qs, maxOf(qe, qs), BulletSpan::class.java)) text.removeSpan(span)
            if (on) text.setSpan(NumberSpan(), qs, whole, Spanned.SPAN_PARAGRAPH)
            if (qe >= pe) break
            cursor = qe + 1
        }
    }

    fun toggleBullet(text: Editable, start: Int, end: Int) {
        val (ps, pe) = paragraphRange(text, start, end)
        val existing = text.getSpans(ps, pe, BulletSpan::class.java)
        // handle every paragraph in the selection
        var cursor = ps
        val on = existing.isEmpty()
        while (cursor <= pe) {
            val (qs, qe) = paragraphRange(text, cursor, cursor)
            for (span in text.getSpans(qs, maxOf(qe, qs), BulletSpan::class.java)) text.removeSpan(span)
            for (span in text.getSpans(qs, maxOf(qe, qs), NumberSpan::class.java)) text.removeSpan(span)
            if (on) text.setSpan(BulletSpan(28), qs, if (qe < text.length) qe + 1 else qe, Spanned.SPAN_PARAGRAPH)
            if (qe >= pe) break
            cursor = qe + 1
        }
    }

    fun colorAtStart(text: Spanned, pos: Int): Int? =
        text.getSpans((pos - 1).coerceAtLeast(0), pos.coerceAtMost(text.length).coerceAtLeast(1), ForegroundColorSpan::class.java).firstOrNull()?.foregroundColor

    @Suppress("unused")
    private val keep: List<Class<out CharacterStyle>> = listOf(BackgroundColorSpan::class.java)
}
