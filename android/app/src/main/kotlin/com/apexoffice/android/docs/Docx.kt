package com.apexoffice.android.docs

import android.graphics.Color
import android.graphics.Typeface
import android.text.Layout
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.AbsoluteSizeSpan
import android.text.style.AlignmentSpan
import android.text.style.BackgroundColorSpan
import android.text.style.BulletSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.UnderlineSpan
import android.util.Xml
import org.xmlpull.v1.XmlPullParser
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

class DocxResult(val text: SpannableStringBuilder, val notes: List<String>)

/**
 * Reads and writes the text, character styling, headings, bullet lists and alignment of a
 * .docx. Anything else in a file (images, tables' structure, headers, comments) is reported in
 * [DocxResult.notes] so the app never overwrites the original without saying what it would lose.
 */
object Docx {
    private class Op(val kind: String, val start: Int, val end: Int, val value: String = "")

    fun read(bytes: ByteArray): DocxResult {
        var documentXml: ByteArray? = null
        var numberingXml: ByteArray? = null
        val notes = linkedSetOf<String>()
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
            var entry: ZipEntry? = zip.nextEntry
            while (entry != null) {
                val name = entry.name
                when {
                    name == "word/document.xml" -> documentXml = zip.readBytes()
                    name == "word/numbering.xml" -> numberingXml = zip.readBytes()
                    name.startsWith("word/header") || name.startsWith("word/footer") -> notes.add("headers and footers")
                    name.startsWith("word/comments") -> notes.add("comments")
                    name.startsWith("word/footnotes") || name.startsWith("word/endnotes") -> notes.add("footnotes")
                    name.startsWith("word/media/") -> notes.add("pictures")
                }
                entry = zip.nextEntry
            }
        }
        val xml = documentXml ?: throw IllegalArgumentException("This is not a Word document.")
        val decimalLists = decimalNumIds(numberingXml)
        val sb = StringBuilder()
        val ops = ArrayList<Op>()
        val parser = Xml.newPullParser()
        // Android enables namespaces by default, which strips the "w:" prefix the code below matches
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
        parser.setInput(ByteArrayInputStream(xml), "UTF-8")

        var tableDepth = 0
        var pStart = 0
        var align = ""
        var heading = 0
        var bullet = false
        var numbered = false
        var rStart = 0
        var inRun = false
        var bold = false
        var italic = false
        var underline = false
        var strike = false
        var color: String? = null
        var size = 0
        var highlight: String? = null
        var inPPr = false
        var inRPr = false
        var inText = false

        fun flag(p: XmlPullParser): Boolean {
            val v = p.getAttributeValue(null, "w:val")
            return v == null || (v != "0" && v != "false" && v != "off" && v != "none")
        }

        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT) {
            when (event) {
                XmlPullParser.START_TAG -> when (parser.name) {
                    "w:p" -> { pStart = sb.length; align = ""; heading = 0; bullet = false; numbered = false }
                    "w:pPr" -> inPPr = true
                    "w:rPr" -> if (inRun) inRPr = true
                    "w:r" -> { inRun = true; rStart = sb.length; bold = false; italic = false; underline = false; strike = false; color = null; size = 0; highlight = null }
                    "w:t" -> inText = true
                    "w:tab" -> if (inRun && !inPPr) sb.append('\t')
                    "w:br", "w:cr" -> if (inRun) sb.append('\n')
                    "w:tbl" -> { tableDepth++; notes.add("tables (shown as tab-separated text)") }
                    "w:drawing", "w:pict" -> { sb.append("[picture]"); notes.add("pictures") }
                    "w:jc" -> if (inPPr) align = parser.getAttributeValue(null, "w:val") ?: ""
                    "w:numPr" -> if (inPPr) bullet = true
                    "w:numId" -> if (inPPr) { if (parser.getAttributeValue(null, "w:val") in decimalLists) numbered = true }
                    "w:pStyle" -> if (inPPr) {
                        val id = (parser.getAttributeValue(null, "w:val") ?: "").lowercase().replace(" ", "")
                        if (id.startsWith("listnumber")) numbered = true
                        else if (id.startsWith("listbullet") || id == "listparagraph") bullet = true
                        heading = when {
                            id.startsWith("heading") -> id.removePrefix("heading").toIntOrNull()?.coerceIn(1, 3) ?: 0
                            id == "title" -> 1
                            id == "subtitle" -> 3
                            else -> 0
                        }
                    }
                    "w:b" -> if (inRPr) bold = flag(parser)
                    "w:i" -> if (inRPr) italic = flag(parser)
                    "w:u" -> if (inRPr) underline = flag(parser)
                    "w:strike" -> if (inRPr) strike = flag(parser)
                    "w:color" -> if (inRPr) color = parser.getAttributeValue(null, "w:val")?.takeIf { it.length == 6 && it != "auto" }
                    "w:sz" -> if (inRPr) size = parser.getAttributeValue(null, "w:val")?.toIntOrNull() ?: 0
                    "w:highlight" -> if (inRPr) highlight = parser.getAttributeValue(null, "w:val")
                    "w:sectPr" -> {}
                }
                XmlPullParser.TEXT -> if (inText) sb.append(parser.text)
                XmlPullParser.END_TAG -> when (parser.name) {
                    "w:t" -> inText = false
                    "w:pPr" -> inPPr = false
                    "w:rPr" -> inRPr = false
                    "w:r" -> {
                        inRun = false
                        val end = sb.length
                        if (end > rStart) {
                            if (bold) ops.add(Op("b", rStart, end))
                            if (italic) ops.add(Op("i", rStart, end))
                            if (underline) ops.add(Op("u", rStart, end))
                            if (strike) ops.add(Op("s", rStart, end))
                            color?.let { ops.add(Op("c", rStart, end, it)) }
                            if (size > 0) ops.add(Op("z", rStart, end, size.toString()))
                            highlight?.let { ops.add(Op("h", rStart, end, it)) }
                        }
                    }
                    "w:tc" -> sb.append('\t')
                    "w:tr" -> { if (sb.endsWith('\t')) sb.setLength(sb.length - 1); sb.append('\n') }
                    "w:tbl" -> tableDepth = (tableDepth - 1).coerceAtLeast(0)
                    "w:p" -> {
                        val end = sb.length
                        if (tableDepth == 0) {
                            if (heading > 0) ops.add(Op("H", pStart, end, heading.toString()))
                            if (numbered) ops.add(Op("N", pStart, end)) else if (bullet) ops.add(Op("L", pStart, end))
                            if (align.isNotEmpty()) ops.add(Op("a", pStart, end, align))
                            sb.append('\n')
                        }
                    }
                }
            }
            event = parser.next()
        }
        if (sb.endsWith('\n')) sb.setLength(sb.length - 1)

        val out = SpannableStringBuilder(sb.toString())
        val incl = Spanned.SPAN_EXCLUSIVE_INCLUSIVE
        for (op in ops) {
            val s = op.start.coerceIn(0, out.length)
            var e = op.end.coerceIn(0, out.length)
            if (e < s || (e == s && op.kind != "H" && op.kind != "L" && op.kind != "N" && op.kind != "a")) continue
            // a paragraph span has to include the line break that ends the paragraph
            if ((op.kind == "L" || op.kind == "N" || op.kind == "a") && e < out.length && out[e] == '\n') e++
            when (op.kind) {
                "b" -> out.setSpan(StyleSpan(Typeface.BOLD), s, e, incl)
                "i" -> out.setSpan(StyleSpan(Typeface.ITALIC), s, e, incl)
                "u" -> out.setSpan(UnderlineSpan(), s, e, incl)
                "s" -> out.setSpan(StrikethroughSpan(), s, e, incl)
                "c" -> out.setSpan(ForegroundColorSpan(Color.parseColor("#" + op.value)), s, e, incl)
                "z" -> out.setSpan(AbsoluteSizeSpan(Math.round(op.value.toInt() / 2f * PT_TO_SP), true), s, e, incl)
                "h" -> highlightColor(op.value)?.let { out.setSpan(BackgroundColorSpan(it), s, e, incl) }
                "H" -> out.setSpan(HeadingSpan(op.value.toInt()), s, e, incl)
                "L" -> out.setSpan(BulletSpan(28), s, e, Spanned.SPAN_PARAGRAPH)
                "N" -> out.setSpan(NumberSpan(), s, e, Spanned.SPAN_PARAGRAPH)
                "a" -> {
                    val a = when (op.value) {
                        "center" -> Layout.Alignment.ALIGN_CENTER
                        "right", "end" -> Layout.Alignment.ALIGN_OPPOSITE
                        else -> null
                    }
                    if (a != null) out.setSpan(AlignmentSpan.Standard(a), s, e, Spanned.SPAN_PARAGRAPH)
                }
            }
        }
        return DocxResult(out, notes.toList())
    }

    /** numId values whose first level is numbered (not a bullet). */
    private fun decimalNumIds(xml: ByteArray?): Set<String> {
        if (xml == null) return emptySet()
        val formats = HashMap<String, String>()
        val nums = HashMap<String, String>()
        val parser = Xml.newPullParser()
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
        parser.setInput(ByteArrayInputStream(xml), "UTF-8")
        var abstractId = ""
        var numId = ""
        var inFirstLevel = false
        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT) {
            if (event == XmlPullParser.START_TAG) when (parser.name) {
                "w:abstractNum" -> { abstractId = parser.getAttributeValue(null, "w:abstractNumId") ?: ""; inFirstLevel = false }
                "w:lvl" -> inFirstLevel = parser.getAttributeValue(null, "w:ilvl") == "0"
                "w:numFmt" -> if (inFirstLevel && abstractId.isNotEmpty() && abstractId !in formats) formats[abstractId] = parser.getAttributeValue(null, "w:val") ?: ""
                "w:num" -> numId = parser.getAttributeValue(null, "w:numId") ?: ""
                "w:abstractNumId" -> if (numId.isNotEmpty()) nums[numId] = parser.getAttributeValue(null, "w:val") ?: ""
            }
            event = parser.next()
        }
        return nums.filter { (_, abs) -> formats[abs]?.let { it != "bullet" && it != "none" } == true }.keys
    }

    private fun highlightColor(name: String): Int? = when (name) {
        "yellow" -> 0xFFFFFF00.toInt()
        "green" -> 0xFF00FF00.toInt()
        "cyan" -> 0xFF00FFFF.toInt()
        "magenta" -> 0xFFFF00FF.toInt()
        "lightGray" -> 0xFFD3D3D3.toInt()
        else -> null
    }

    private fun esc(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    fun write(text: Spanned): ByteArray {
        val body = StringBuilder()
        var start = 0
        val s = text.toString()
        while (start <= s.length) {
            var end = s.indexOf('\n', start)
            if (end < 0) end = s.length
            body.append(paragraph(text, start, end))
            if (end >= s.length) break
            start = end + 1
        }
        val doc = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
            "<w:document xmlns:w=\"$W\"><w:body>$body" +
            "<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" w:header=\"708\" w:footer=\"708\" w:gutter=\"0\"/></w:sectPr>" +
            "</w:body></w:document>"
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            fun put(name: String, content: String) {
                zip.putNextEntry(ZipEntry(name)); zip.write(content.toByteArray(Charsets.UTF_8)); zip.closeEntry()
            }
            put("[Content_Types].xml", CONTENT_TYPES)
            put("_rels/.rels", ROOT_RELS)
            put("word/document.xml", doc)
            put("word/_rels/document.xml.rels", DOC_RELS)
            put("word/styles.xml", STYLES)
            put("word/numbering.xml", NUMBERING)
        }
        return out.toByteArray()
    }

    private fun paragraph(text: Spanned, ps: Int, pe: Int): String {
        val props = StringBuilder()
        val heading = text.getSpans(ps, maxOf(pe, ps), HeadingSpan::class.java).firstOrNull { text.getSpanStart(it) <= ps || pe == ps }?.level
            ?: text.getSpans(ps, maxOf(pe, ps), HeadingSpan::class.java).firstOrNull()?.level ?: 0
        if (heading in 1..3) props.append("<w:pStyle w:val=\"Heading$heading\"/>")
        if (text.getSpans(ps, maxOf(pe, ps), NumberSpan::class.java).isNotEmpty()) {
            props.append("<w:pStyle w:val=\"ListParagraph\"/><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"2\"/></w:numPr>")
        } else if (text.getSpans(ps, maxOf(pe, ps), BulletSpan::class.java).isNotEmpty()) {
            props.append("<w:pStyle w:val=\"ListParagraph\"/><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"1\"/></w:numPr>")
        }
        text.getSpans(ps, maxOf(pe, ps), AlignmentSpan::class.java).firstOrNull()?.let {
            when (it.alignment) {
                Layout.Alignment.ALIGN_CENTER -> props.append("<w:jc w:val=\"center\"/>")
                Layout.Alignment.ALIGN_OPPOSITE -> props.append("<w:jc w:val=\"right\"/>")
                else -> {}
            }
        }
        // split the paragraph wherever any span starts or ends
        val cuts = sortedSetOf(ps, pe)
        for (span in text.getSpans(ps, pe, Any::class.java)) {
            val a = text.getSpanStart(span)
            val b = text.getSpanEnd(span)
            if (a in ps..pe) cuts.add(a)
            if (b in ps..pe) cuts.add(b)
        }
        val points = cuts.toList()
        val runs = StringBuilder()
        for (i in 0 until points.size - 1) {
            val a = points[i]
            val b = points[i + 1]
            if (b <= a) continue
            val run = runProps(text, a, b)
            val pieces = text.subSequence(a, b).toString().split('\t')
            val content = StringBuilder()
            pieces.forEachIndexed { index, piece ->
                if (index > 0) content.append("<w:tab/>")
                if (piece.isNotEmpty()) content.append("<w:t xml:space=\"preserve\">${esc(piece)}</w:t>")
            }
            runs.append("<w:r>").append(if (run.isEmpty()) "" else "<w:rPr>$run</w:rPr>").append(content).append("</w:r>")
        }
        return "<w:p>" + (if (props.isEmpty()) "" else "<w:pPr>$props</w:pPr>") + runs + "</w:p>"
    }

    private fun runProps(text: Spanned, a: Int, b: Int): String {
        val sb = StringBuilder()
        var bold = false
        var italic = false
        var underline = false
        var strike = false
        var color: Int? = null
        var size: Int? = null
        var highlight: Int? = null
        for (span in text.getSpans(a, b, Any::class.java)) {
            if (text.getSpanStart(span) > a || text.getSpanEnd(span) < b) continue
            when (span) {
                is StyleSpan -> { if (span.style and Typeface.BOLD != 0) bold = true; if (span.style and Typeface.ITALIC != 0) italic = true }
                is UnderlineSpan -> underline = true
                is StrikethroughSpan -> strike = true
                is ForegroundColorSpan -> color = span.foregroundColor
                is AbsoluteSizeSpan -> size = Math.round(span.size / PT_TO_SP * 2f)
                is BackgroundColorSpan -> highlight = span.backgroundColor
            }
        }
        if (bold) sb.append("<w:b/>")
        if (italic) sb.append("<w:i/>")
        if (underline) sb.append("<w:u w:val=\"single\"/>")
        if (strike) sb.append("<w:strike/>")
        color?.let { sb.append("<w:color w:val=\"%06X\"/>".format(it and 0xFFFFFF)) }
        size?.let { sb.append("<w:sz w:val=\"$it\"/>") }
        highlight?.let { c ->
            val name = when (c) { 0xFFFFFF00.toInt() -> "yellow"; 0xFF00FF00.toInt() -> "green"; 0xFF00FFFF.toInt() -> "cyan"; 0xFFFF00FF.toInt() -> "magenta"; else -> null }
            name?.let { sb.append("<w:highlight w:val=\"$it\"/>") }
        }
        return sb.toString()
    }

    private const val W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    private const val CONTENT_TYPES = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
        "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
        "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
        "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
        "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>" +
        "<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>" +
        "<Override PartName=\"/word/numbering.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml\"/>" +
        "</Types>"
    private const val ROOT_RELS = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>"
    private const val DOC_RELS = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>" +
        "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering\" Target=\"numbering.xml\"/></Relationships>"
    private const val STYLES = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
        "<w:styles xmlns:w=\"$W\">" +
        "<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii=\"Calibri\" w:hAnsi=\"Calibri\" w:cs=\"Calibri\"/><w:sz w:val=\"22\"/></w:rPr></w:rPrDefault>" +
        "<w:pPrDefault><w:pPr><w:spacing w:after=\"120\" w:line=\"264\" w:lineRule=\"auto\"/></w:pPr></w:pPrDefault></w:docDefaults>" +
        "<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/></w:style>" +
        "<w:style w:type=\"paragraph\" w:styleId=\"Heading1\"><w:name w:val=\"heading 1\"/><w:basedOn w:val=\"Normal\"/><w:next w:val=\"Normal\"/><w:pPr><w:keepNext/><w:spacing w:before=\"360\" w:after=\"120\"/><w:outlineLvl w:val=\"0\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"40\"/></w:rPr></w:style>" +
        "<w:style w:type=\"paragraph\" w:styleId=\"Heading2\"><w:name w:val=\"heading 2\"/><w:basedOn w:val=\"Normal\"/><w:next w:val=\"Normal\"/><w:pPr><w:keepNext/><w:spacing w:before=\"240\" w:after=\"80\"/><w:outlineLvl w:val=\"1\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"32\"/></w:rPr></w:style>" +
        "<w:style w:type=\"paragraph\" w:styleId=\"Heading3\"><w:name w:val=\"heading 3\"/><w:basedOn w:val=\"Normal\"/><w:next w:val=\"Normal\"/><w:pPr><w:keepNext/><w:spacing w:before=\"200\" w:after=\"60\"/><w:outlineLvl w:val=\"2\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"26\"/></w:rPr></w:style>" +
        "<w:style w:type=\"paragraph\" w:styleId=\"ListParagraph\"><w:name w:val=\"List Paragraph\"/><w:basedOn w:val=\"Normal\"/><w:pPr><w:ind w:left=\"720\"/></w:pPr></w:style>" +
        "</w:styles>"
    private const val NUMBERING = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
        "<w:numbering xmlns:w=\"$W\"><w:abstractNum w:abstractNumId=\"0\"><w:multiLevelType w:val=\"hybridMultilevel\"/>" +
        "<w:lvl w:ilvl=\"0\"><w:start w:val=\"1\"/><w:numFmt w:val=\"bullet\"/><w:lvlText w:val=\"•\"/><w:lvlJc w:val=\"left\"/><w:pPr><w:ind w:left=\"720\" w:hanging=\"360\"/></w:pPr></w:lvl>" +
        "</w:abstractNum>" +
        "<w:abstractNum w:abstractNumId=\"1\"><w:multiLevelType w:val=\"hybridMultilevel\"/>" +
        "<w:lvl w:ilvl=\"0\"><w:start w:val=\"1\"/><w:numFmt w:val=\"decimal\"/><w:lvlText w:val=\"%1.\"/><w:lvlJc w:val=\"left\"/><w:pPr><w:ind w:left=\"720\" w:hanging=\"360\"/></w:pPr></w:lvl>" +
        "</w:abstractNum><w:num w:numId=\"1\"><w:abstractNumId w:val=\"0\"/></w:num><w:num w:numId=\"2\"><w:abstractNumId w:val=\"1\"/></w:num></w:numbering>"
}
