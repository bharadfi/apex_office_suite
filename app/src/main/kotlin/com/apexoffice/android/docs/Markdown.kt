package com.apexoffice.android.docs

import android.graphics.Color
import android.graphics.Typeface
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.text.style.BulletSpan
import android.text.style.ForegroundColorSpan
import android.text.style.LeadingMarginSpan
import android.text.style.RelativeSizeSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.TypefaceSpan
import android.text.style.URLSpan

/** Renders the common Markdown subset to styled text for the preview. Tables and images show as plain text. */
object Markdown {
    private val numbered = Regex("^(\\s*)(\\d+)[.)]\\s+(.*)$")
    private val bulleted = Regex("^(\\s*)[-*+]\\s+(.*)$")
    private val heading = Regex("^(#{1,6})\\s+(.*?)\\s*#*\\s*$")

    fun render(source: String, linkColor: Int = Color.parseColor("#1B6FA8")): CharSequence {
        val out = SpannableStringBuilder()
        var inCode = false
        val lines = source.replace("\r\n", "\n").replace('\r', '\n').split('\n')
        for ((i, raw) in lines.withIndex()) {
            val line = raw.trimEnd()
            val start = out.length
            var para: Any? = null
            if (line.trimStart().startsWith("```")) {
                inCode = !inCode
                continue
            }
            if (inCode) {
                out.append(line).append('\n')
                out.setSpan(TypefaceSpan("monospace"), start, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                out.setSpan(BackgroundColorSpan(Color.parseColor("#EEF1EF")), start, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                continue
            }
            val h = heading.matchEntire(line)
            when {
                h != null -> {
                    val level = h.groupValues[1].length
                    inline(out, h.groupValues[2], linkColor)
                    out.setSpan(StyleSpan(Typeface.BOLD), start, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                    out.setSpan(RelativeSizeSpan(when (level) { 1 -> 1.7f; 2 -> 1.45f; 3 -> 1.25f; 4 -> 1.1f; else -> 1f }), start, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                }
                Regex("^\\s*([-*_])(\\s*\\1){2,}\\s*$").matches(line) -> out.append("─".repeat(24))
                line.trimStart().startsWith(">") -> {
                    inline(out, line.trimStart().removePrefix(">").trim(), linkColor)
                    para = LeadingMarginSpan.Standard(40)
                    out.setSpan(ForegroundColorSpan(Color.parseColor("#5B6B63")), start, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                    out.setSpan(StyleSpan(Typeface.ITALIC), start, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                }
                bulleted.matches(line) -> {
                    val m = bulleted.matchEntire(line)!!
                    inline(out, m.groupValues[2], linkColor)
                    para = BulletSpan(28)
                }
                numbered.matches(line) -> {
                    val m = numbered.matchEntire(line)!!
                    out.append(m.groupValues[2]).append(". ")
                    inline(out, m.groupValues[3], linkColor)
                    para = LeadingMarginSpan.Standard(28)
                }
                else -> inline(out, line, linkColor)
            }
            if (i < lines.size - 1) out.append('\n')
            // a paragraph span must end on the line break (or at the end of the text)
            para?.let { out.setSpan(it, start, out.length, Spanned.SPAN_PARAGRAPH) }
        }
        return out
    }

    private fun inline(out: SpannableStringBuilder, text: String, linkColor: Int) {
        var i = 0
        while (i < text.length) {
            when {
                text.startsWith("**", i) || text.startsWith("__", i) -> {
                    val mark = text.substring(i, i + 2)
                    val end = text.indexOf(mark, i + 2)
                    if (end > i + 2) { span(out, text.substring(i + 2, end), linkColor) { StyleSpan(Typeface.BOLD) }; i = end + 2 } else { out.append(text[i]); i++ }
                }
                text.startsWith("~~", i) -> {
                    val end = text.indexOf("~~", i + 2)
                    if (end > i + 2) { span(out, text.substring(i + 2, end), linkColor) { StrikethroughSpan() }; i = end + 2 } else { out.append(text[i]); i++ }
                }
                text[i] == '`' -> {
                    val end = text.indexOf('`', i + 1)
                    if (end > i + 1) {
                        val s = out.length
                        out.append(text.substring(i + 1, end))
                        out.setSpan(TypefaceSpan("monospace"), s, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                        out.setSpan(BackgroundColorSpan(Color.parseColor("#EEF1EF")), s, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                        i = end + 1
                    } else { out.append(text[i]); i++ }
                }
                (text[i] == '*' || text[i] == '_') && i + 1 < text.length && text[i + 1] != ' ' -> {
                    val end = text.indexOf(text[i], i + 1)
                    if (end > i + 1) { span(out, text.substring(i + 1, end), linkColor) { StyleSpan(Typeface.ITALIC) }; i = end + 1 } else { out.append(text[i]); i++ }
                }
                text[i] == '[' -> {
                    val close = text.indexOf("](", i)
                    val end = if (close > 0) text.indexOf(')', close) else -1
                    if (close > i && end > close) {
                        val s = out.length
                        out.append(text.substring(i + 1, close))
                        out.setSpan(URLSpan(text.substring(close + 2, end)), s, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                        out.setSpan(ForegroundColorSpan(linkColor), s, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                        i = end + 1
                    } else { out.append(text[i]); i++ }
                }
                else -> { out.append(text[i]); i++ }
            }
        }
    }

    private fun span(out: SpannableStringBuilder, inner: String, linkColor: Int, make: () -> Any) {
        val s = out.length
        inline(out, inner, linkColor)
        out.setSpan(make(), s, out.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
}
