package com.apexoffice.android.slides

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.text.Layout
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.StaticLayout
import android.text.TextPaint
import android.text.style.AbsoluteSizeSpan
import android.text.style.AlignmentSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.text.style.UnderlineSpan
import org.w3c.dom.Document
import org.w3c.dom.Element
import org.w3c.dom.Node
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream
import javax.xml.parsers.DocumentBuilderFactory
import javax.xml.transform.OutputKeys
import javax.xml.transform.TransformerFactory
import javax.xml.transform.dom.DOMSource
import javax.xml.transform.stream.StreamResult

class Frame(val x: Long, val y: Long, val w: Long, val h: Long)

class Shape(
    val frame: Frame,
    val geometry: String,
    val fill: Int?,
    val line: Int?,
    val picture: String?,
    val textBody: Element?,
    val placeholder: String?,
) {
    val hasText: Boolean get() = textBody != null
}

class Slide(val path: String, val shapes: List<Shape>, val background: Int?)

/** A presentation read for viewing and for text edits that leave the rest of the package untouched. */
class Deck private constructor(
    val width: Long,
    val height: Long,
    val slides: List<Slide>,
    private val original: ByteArray,
    private val docs: Map<String, Document>,
    private val media: Map<String, ByteArray>,
    private val theme: Map<String, Int>,
    private val titleSizePt: Float,
    private val bodySizePt: Float,
) {
    val modified = linkedSetOf<String>()
    private val bitmaps = HashMap<String, Bitmap?>()

    fun picture(path: String): Bitmap? = bitmaps.getOrPut(path) {
        media[path]?.let { bytes ->
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            val sample = maxOf(1, maxOf(bounds.outWidth, bounds.outHeight) / 2048)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
        }
    }

    // ---- text ----

    fun paragraphsOf(shape: Shape): List<String> =
        shape.textBody?.let { body -> children(body, "a:p").map { p -> runs(p).joinToString("") { it.text } } } ?: emptyList()

    /** Replace the shape's text; the first run of each paragraph keeps its formatting. */
    fun setText(slide: Slide, shape: Shape, lines: List<String>) {
        val body = shape.textBody ?: return
        val doc = body.ownerDocument
        val paragraphs = children(body, "a:p")
        val template = paragraphs.firstOrNull()
        lines.forEachIndexed { i, line ->
            val p = paragraphs.getOrNull(i) ?: (template?.cloneNode(true) as? Element)?.also {
                body.insertBefore(it, paragraphs.last().nextSibling)
                children(it, "a:r").forEach { r -> it.removeChild(r) }
            } ?: return@forEachIndexed
            val rs = children(p, "a:r")
            if (rs.isEmpty()) {
                val r = doc.createElement("a:r")
                val t = doc.createElement("a:t")
                t.textContent = line
                r.appendChild(t)
                val end = children(p, "a:endParaRPr").firstOrNull()
                if (end != null) p.insertBefore(r, end) else p.appendChild(r)
            } else {
                rs.drop(1).forEach { p.removeChild(it) }
                children(rs.first(), "a:t").firstOrNull()?.textContent = line
            }
            children(p, "a:br").forEach { p.removeChild(it) }
            children(p, "a:fld").forEach { p.removeChild(it) }
        }
        // drop paragraphs the user removed
        children(body, "a:p").drop(maxOf(lines.size, 1)).forEach { body.removeChild(it) }
        modified.add(slide.path)
    }

    fun write(): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            ZipInputStream(ByteArrayInputStream(original)).use { input ->
                var entry = input.nextEntry
                while (entry != null) {
                    val data = input.readBytes()
                    zip.putNextEntry(ZipEntry(entry.name))
                    val doc = docs[entry.name]
                    if (entry.name in modified && doc != null) zip.write(serialize(doc)) else zip.write(data)
                    zip.closeEntry()
                    entry = input.nextEntry
                }
            }
        }
        return out.toByteArray()
    }

    private fun serialize(doc: Document): ByteArray {
        val t = TransformerFactory.newInstance().newTransformer()
        t.setOutputProperty(OutputKeys.ENCODING, "UTF-8")
        t.setOutputProperty(OutputKeys.STANDALONE, "yes")
        val bos = ByteArrayOutputStream()
        t.transform(DOMSource(doc), StreamResult(bos))
        return bos.toByteArray()
    }

    // ---- drawing ----

    private class Run(val text: String, val sizePt: Float?, val bold: Boolean, val italic: Boolean, val underline: Boolean, val color: Int?)

    private fun runs(p: Element): List<Run> = childrenAny(p).mapNotNull { n ->
        when (n.tagName) {
            "a:r", "a:fld" -> {
                val rPr = children(n, "a:rPr").firstOrNull()
                Run(
                    children(n, "a:t").joinToString("") { it.textContent },
                    rPr?.getAttribute("sz")?.toFloatOrNull()?.div(100f),
                    rPr?.getAttribute("b") == "1",
                    rPr?.getAttribute("i") == "1",
                    rPr?.getAttribute("u")?.let { it.isNotEmpty() && it != "none" } == true,
                    rPr?.let { colorOf(it) },
                )
            }
            "a:br" -> Run("\n", null, false, false, false, null)
            else -> null
        }
    }

    private fun colorOf(parent: Element): Int? {
        val fill = children(parent, "a:solidFill").firstOrNull() ?: return null
        return solid(fill)
    }

    private fun solid(fill: Element): Int? {
        val c = childrenAny(fill).firstOrNull() ?: return null
        return when (c.tagName) {
            "a:srgbClr" -> parse(c.getAttribute("val"))
            "a:schemeClr" -> theme[mapScheme(c.getAttribute("val"))]
            "a:sysClr" -> parse(c.getAttribute("lastClr"))
            else -> null
        }
    }

    private fun mapScheme(v: String) = when (v) { "tx1" -> "dk1"; "bg1" -> "lt1"; "tx2" -> "dk2"; "bg2" -> "lt2"; else -> v }
    private fun parse(hex: String): Int? = if (hex.length == 6) hex.toIntOrNull(16)?.let { 0xFF000000.toInt() or it } else null

    fun draw(canvas: Canvas, slide: Slide, widthPx: Float) {
        val scale = widthPx / width.toFloat()
        val bg = slide.background ?: Color.WHITE
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        paint.color = bg
        canvas.drawRect(0f, 0f, widthPx, height * scale, paint)
        val darkBackground = (Color.red(bg) * 0.299 + Color.green(bg) * 0.587 + Color.blue(bg) * 0.114) < 110
        for (shape in slide.shapes) {
            val r = rect(shape.frame, scale)
            shape.fill?.let {
                paint.style = Paint.Style.FILL; paint.color = it
                when (shape.geometry) {
                    "ellipse" -> canvas.drawOval(r, paint)
                    "roundRect" -> canvas.drawRoundRect(r, r.height() * 0.12f, r.height() * 0.12f, paint)
                    else -> canvas.drawRect(r, paint)
                }
            }
            shape.line?.let {
                paint.style = Paint.Style.STROKE; paint.strokeWidth = maxOf(1f, 12700 * scale); paint.color = it
                if (shape.geometry == "ellipse") canvas.drawOval(r, paint) else canvas.drawRect(r, paint)
            }
            shape.picture?.let { path -> picture(path)?.let { canvas.drawBitmap(it, null, r, Paint(Paint.FILTER_BITMAP_FLAG)) } }
            if (shape.hasText) drawText(canvas, shape, r, scale, if (darkBackground) Color.WHITE else (theme["dk1"] ?: Color.BLACK))
        }
    }

    private fun rect(f: Frame, scale: Float) = RectF(f.x * scale, f.y * scale, (f.x + f.w) * scale, (f.y + f.h) * scale)

    private fun drawText(canvas: Canvas, shape: Shape, r: RectF, scale: Float, defaultColor: Int) {
        val body = shape.textBody ?: return
        val pxPerPt = 12700f * scale
        val bodyPr = children(body, "a:bodyPr").firstOrNull()
        val fit = bodyPr?.let { children(it, "a:normAutofit").firstOrNull() }?.getAttribute("fontScale")?.toFloatOrNull()?.div(100000f) ?: 1f
        val sb = SpannableStringBuilder()
        val isTitle = shape.placeholder == "title" || shape.placeholder == "ctrTitle"
        val defaultPt = when {
            isTitle -> titleSizePt
            shape.placeholder == "subTitle" -> bodySizePt * 0.8f
            shape.placeholder != null -> bodySizePt
            else -> 18f
        }
        for (p in children(body, "a:p")) {
            val start = sb.length
            val pPr = children(p, "a:pPr").firstOrNull()
            if (pPr != null && childrenAny(pPr).any { it.tagName == "a:buChar" || it.tagName == "a:buAutoNum" }) sb.append("• ")
            val rs = runs(p)
            for (run in rs) {
                val s = sb.length
                sb.append(run.text)
                if (sb.length == s) continue
                val size = (run.sizePt ?: defaultPt) * fit * pxPerPt
                sb.setSpan(AbsoluteSizeSpan(maxOf(1, Math.round(size)), false), s, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                sb.setSpan(ForegroundColorSpan(run.color ?: defaultColor), s, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                if (run.bold || isTitle && false) sb.setSpan(StyleSpan(Typeface.BOLD), s, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                if (run.italic) sb.setSpan(StyleSpan(Typeface.ITALIC), s, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                if (run.underline) sb.setSpan(UnderlineSpan(), s, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            }
            if (sb.length == start) {
                // an empty paragraph still takes a line
                sb.append(" ")
                sb.setSpan(AbsoluteSizeSpan(maxOf(1, Math.round(defaultPt * fit * pxPerPt)), false), start, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            }
            val algn = when (pPr?.getAttribute("algn")) {
                "ctr" -> Layout.Alignment.ALIGN_CENTER
                "r" -> Layout.Alignment.ALIGN_OPPOSITE
                else -> Layout.Alignment.ALIGN_NORMAL
            }
            sb.append('\n')
            sb.setSpan(AlignmentSpan.Standard(if (isTitle && pPr?.getAttribute("algn").isNullOrEmpty() && shape.placeholder == "ctrTitle") Layout.Alignment.ALIGN_CENTER else algn), start, sb.length, Spanned.SPAN_PARAGRAPH)
        }
        if (sb.endsWith("\n")) sb.delete(sb.length - 1, sb.length)
        val insetX = (bodyPr?.getAttribute("lIns")?.toFloatOrNull() ?: 91440f) * scale
        val insetY = (bodyPr?.getAttribute("tIns")?.toFloatOrNull() ?: 45720f) * scale
        val avail = (r.width() - insetX * 2).toInt().coerceAtLeast(8)
        val paint = TextPaint(Paint.ANTI_ALIAS_FLAG)
        val layout = StaticLayout.Builder.obtain(sb, 0, sb.length, paint, avail).setLineSpacing(0f, 1.0f).build()
        val anchor = bodyPr?.getAttribute("anchor") ?: if (isTitle) "ctr" else "t"
        val top = when (anchor) {
            "ctr" -> r.top + (r.height() - layout.height) / 2f
            "b" -> r.bottom - layout.height - insetY
            else -> r.top + insetY
        }
        canvas.save()
        canvas.clipRect(r.left, r.top - 0.5f * r.height(), r.right, r.bottom + 0.5f * r.height())
        canvas.translate(r.left + insetX, top)
        layout.draw(canvas)
        canvas.restore()
    }

    companion object {
        private fun childrenAny(e: Element): List<Element> {
            val out = ArrayList<Element>()
            var n: Node? = e.firstChild
            while (n != null) { if (n is Element) out.add(n); n = n.nextSibling }
            return out
        }
        private fun children(e: Element, name: String): List<Element> = childrenAny(e).filter { it.tagName == name }
        private fun first(e: Element, vararg path: String): Element? {
            var cur: Element? = e
            for (name in path) cur = cur?.let { children(it, name).firstOrNull() }
            return cur
        }

        fun read(bytes: ByteArray): Deck {
            val parts = HashMap<String, ByteArray>()
            ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
                var entry = zip.nextEntry
                while (entry != null) {
                    val n = entry.name
                    if (n.endsWith(".xml") || n.endsWith(".rels") || n.startsWith("ppt/media/")) parts[n] = zip.readBytes()
                    entry = zip.nextEntry
                }
            }
            val factory = DocumentBuilderFactory.newInstance().apply { isNamespaceAware = false }
            val docs = HashMap<String, Document>()
            fun doc(path: String): Document? = docs[path] ?: parts[path]?.let { b ->
                runCatching { factory.newDocumentBuilder().parse(ByteArrayInputStream(b)) }.getOrNull()?.also { docs[path] = it }
            }
            fun rels(path: String): Map<String, String> {
                val dir = path.substringBeforeLast('/', "")
                val file = path.substringAfterLast('/')
                val d = doc("$dir/_rels/$file.rels") ?: return emptyMap()
                val map = HashMap<String, String>()
                childrenAny(d.documentElement).forEach { r ->
                    val target = r.getAttribute("Target")
                    val resolved = if (target.startsWith("/")) target.removePrefix("/") else normalize("$dir/$target")
                    map[r.getAttribute("Id")] = resolved
                }
                return map
            }
            val pres = doc("ppt/presentation.xml") ?: throw IllegalArgumentException("This is not a PowerPoint file.")
            val sz = first(pres.documentElement, "p:sldSz")
            val width = sz?.getAttribute("cx")?.toLongOrNull() ?: 9144000L
            val height = sz?.getAttribute("cy")?.toLongOrNull() ?: 5143500L
            val presRels = rels("ppt/presentation.xml")
            val theme = readTheme(doc("ppt/theme/theme1.xml"))

            var titlePt = 40f
            var bodyPt = 24f
            val masterPath = presRels.values.firstOrNull { it.contains("slideMasters/") }
            val master = masterPath?.let { doc(it) }
            master?.documentElement?.let { m ->
                first(m, "p:txStyles", "p:titleStyle", "a:lvl1pPr", "a:defRPr")?.getAttribute("sz")?.toFloatOrNull()?.let { titlePt = it / 100f }
                first(m, "p:txStyles", "p:bodyStyle", "a:lvl1pPr", "a:defRPr")?.getAttribute("sz")?.toFloatOrNull()?.let { bodyPt = it / 100f }
            }

            val order = first(pres.documentElement, "p:sldIdLst")?.let { children(it, "p:sldId") }.orEmpty()
            val slides = ArrayList<Slide>()
            val skeleton = Deck(width, height, emptyList(), bytes, docs, parts.filterKeys { it.startsWith("ppt/media/") }, theme, titlePt, bodyPt)
            for (id in order) {
                val path = presRels[id.getAttribute("r:id")] ?: continue
                val sd = doc(path) ?: continue
                val srels = rels(path)
                val layoutPath = srels.values.firstOrNull { it.contains("slideLayouts/") }
                val layoutDoc = layoutPath?.let { doc(it) }
                val layoutMasterPath = layoutPath?.let { rels(it).values.firstOrNull { v -> v.contains("slideMasters/") } }
                val inherited = HashMap<String, Frame>()
                for (d in listOfNotNull(layoutMasterPath?.let { doc(it) }, layoutDoc)) collectPlaceholders(d.documentElement, inherited)
                val shapes = ArrayList<Shape>()
                val tree = first(sd.documentElement, "p:cSld", "p:spTree")
                if (tree != null) collectShapes(tree, srels, inherited, theme, shapes, skeleton)
                val bg = backgroundOf(sd, theme) ?: layoutDoc?.let { backgroundOf(it, theme) } ?: layoutMasterPath?.let { doc(it) }?.let { backgroundOf(it, theme) }
                slides.add(Slide(path, shapes, bg))
            }
            return Deck(width, height, slides, bytes, docs, parts.filterKeys { it.startsWith("ppt/media/") }, theme, titlePt, bodyPt)
        }

        private fun normalize(path: String): String {
            val out = ArrayDeque<String>()
            for (part in path.split('/')) when (part) { "", "." -> {}; ".." -> out.removeLastOrNull(); else -> out.addLast(part) }
            return out.joinToString("/")
        }

        private fun readTheme(d: Document?): Map<String, Int> {
            val map = HashMap<String, Int>()
            val scheme = d?.documentElement?.let { first(it, "a:themeElements", "a:clrScheme") } ?: return map
            for (c in childrenAny(scheme)) {
                val v = childrenAny(c).firstOrNull() ?: continue
                val hex = if (v.tagName == "a:sysClr") v.getAttribute("lastClr") else v.getAttribute("val")
                if (hex.length == 6) hex.toIntOrNull(16)?.let { map[c.tagName.removePrefix("a:")] = 0xFF000000.toInt() or it }
            }
            return map
        }

        private fun backgroundOf(d: Document, theme: Map<String, Int>): Int? {
            val fill = first(d.documentElement, "p:cSld", "p:bg", "p:bgPr", "a:solidFill") ?: return null
            val c = childrenAny(fill).firstOrNull() ?: return null
            return when (c.tagName) {
                "a:srgbClr" -> c.getAttribute("val").toIntOrNull(16)?.let { 0xFF000000.toInt() or it }
                "a:schemeClr" -> theme[when (val v = c.getAttribute("val")) { "tx1" -> "dk1"; "bg1" -> "lt1"; "tx2" -> "dk2"; "bg2" -> "lt2"; else -> v }]
                else -> null
            }
        }

        private fun frameOf(spPr: Element?): Frame? {
            val xfrm = spPr?.let { first(it, "a:xfrm") } ?: return null
            val off = first(xfrm, "a:off") ?: return null
            val ext = first(xfrm, "a:ext") ?: return null
            return Frame(
                off.getAttribute("x").toLongOrNull() ?: return null, off.getAttribute("y").toLongOrNull() ?: return null,
                ext.getAttribute("cx").toLongOrNull() ?: return null, ext.getAttribute("cy").toLongOrNull() ?: return null,
            )
        }

        private fun placeholderKey(sp: Element): String? {
            val ph = first(sp, "p:nvSpPr", "p:nvPr", "p:ph") ?: return null
            val type = ph.getAttribute("type").ifEmpty { "body" }
            val idx = ph.getAttribute("idx")
            return "$type|$idx"
        }

        private fun collectPlaceholders(root: Element, into: MutableMap<String, Frame>) {
            val tree = first(root, "p:cSld", "p:spTree") ?: return
            for (sp in children(tree, "p:sp")) {
                val key = placeholderKey(sp) ?: continue
                val f = frameOf(first(sp, "p:spPr")) ?: continue
                into[key] = f
                val type = key.substringBefore('|')
                into["$type|"] = into["$type|"] ?: f
            }
        }

        private fun collectShapes(tree: Element, rels: Map<String, String>, inherited: Map<String, Frame>, theme: Map<String, Int>, out: MutableList<Shape>, deck: Deck) {
            for (n in childrenAny(tree)) when (n.tagName) {
                "p:sp" -> {
                    val spPr = first(n, "p:spPr")
                    val key = placeholderKey(n)
                    val type = key?.substringBefore('|')
                    val frame = frameOf(spPr) ?: key?.let { inherited[it] ?: inherited["$type|"] } ?: continue
                    val geom = first(spPr ?: n, "a:prstGeom")?.getAttribute("prst") ?: "rect"
                    val fill = spPr?.let { first(it, "a:solidFill") }?.let { deck.solid(it) }
                    val line = spPr?.let { first(it, "a:ln", "a:solidFill") }?.let { deck.solid(it) }
                    val body = first(n, "p:txBody")
                    out.add(Shape(frame, geom, fill, line, null, body, type))
                }
                "p:pic" -> {
                    val frame = frameOf(first(n, "p:spPr")) ?: continue
                    val embed = first(n, "p:blipFill", "a:blip")?.getAttribute("r:embed")
                    out.add(Shape(frame, "rect", null, null, embed?.let { rels[it] }, null, null))
                }
                "p:grpSp" -> collectShapes(n, rels, inherited, theme, out, deck)
            }
        }
    }
}
