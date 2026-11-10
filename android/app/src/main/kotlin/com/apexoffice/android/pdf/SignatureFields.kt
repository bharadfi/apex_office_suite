package com.apexoffice.android.pdf

import android.content.Context
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.cos.COSArray
import com.tom_roush.pdfbox.cos.COSDictionary
import com.tom_roush.pdfbox.cos.COSName
import com.tom_roush.pdfbox.cos.COSStream
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.interactive.annotation.PDAnnotationWidget
import com.tom_roush.pdfbox.pdmodel.interactive.digitalsignature.PDSignature
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDSignatureField
import java.io.File

/** The verdicts a signature box can show: tick, question mark, cross (as in Adobe and the desktop app). */
enum class MarkVerdict { VALID, UNKNOWN, INVALID }

/**
 * Where a signature's visible area sits on a page, as fractions of the page as displayed (0..1,
 * top-left origin). [hasLayers] is true when the signer's own box already holds a verdict layer,
 * which the display copy redraws; such a box needs no extra badge.
 */
class FieldMark(
    val byteRange: List<Long>,
    val page: Int,
    val x0: Float, val y0: Float, val x1: Float, val y1: Float,
    val hasLayers: Boolean,
    /** a certifying signature (DocMDP): it may say who certified the document once it verifies */
    val certified: Boolean,
)

/** What a signature's box shows: its verdict, and the caption that replaces "Signature Not Verified" when it earns one. */
class SigMark(val verdict: MarkVerdict, val caption: String?)

/**
 * Reads the signature fields from the PDF structure so each can be marked on its page, and builds
 * the copy that is DISPLAYED: the signer's own "unknown" layers redrawn to the real verdict, as
 * the desktop app does. The signed file is never changed; verification always reads its own bytes.
 */
object SignatureFields {
    private enum class Layer { UNKNOWN, VALID, INVALID, CAPTION }
    private class Found(val stream: COSStream, val kind: Layer)

    fun locate(context: Context, bytes: ByteArray, password: String? = null): List<FieldMark> = try {
        PDFBoxResourceLoader.init(context.applicationContext)
        PDDocument.load(bytes, password ?: "").use { doc -> read(doc) }
    } catch (e: Throwable) {
        emptyList() // encrypted or unusual files: the banner and the Tools sheet still report the signatures
    }

    /**
     * A copy of the file with each verdict layer redrawn to [verdicts] (keyed by the signature's
     * byte range), or null when no signature box has such a layer.
     */
    fun display(context: Context, bytes: ByteArray, marks: Map<List<Long>, SigMark>, out: File, password: String? = null): File? = try {
        PDFBoxResourceLoader.init(context.applicationContext)
        PDDocument.load(bytes, password ?: "").use { doc ->
            // a protected file is unlocked in this copy, which is only ever shown or printed, never written back
            if (doc.isEncrypted) doc.isAllSecurityToBeRemoved = true
            var changed = false
            eachSignature(doc) { sig, widget, index ->
                val mark = marks[sig.byteRange.map { it.toLong() }] ?: return@eachSignature
                val verdict = mark.verdict
                val layers = layersOf(widget)
                if (layers.isNotEmpty()) {
                    val done = HashSet<COSStream>()
                    for (layer in layers) {
                        if (!done.add(layer.stream)) continue
                        if (layer.kind == Layer.CAPTION) {
                            // the caption names the certifier only once the signature verifies; until then the signer's own words stand
                            if (mark.caption != null && rewriteCaption(layer.stream, mark.caption)) changed = true
                        } else if (verdict != MarkVerdict.UNKNOWN) {
                            // the signer's own "?" is the standard unknown mark: leave it exactly as signed
                            redraw(layer.stream, verdict)
                            changed = true
                        }
                    }
                } else {
                    val rect = widget.rectangle ?: return@eachSignature
                    if (rect.width < 4f || rect.height < 4f) return@eachSignature
                    val own = widget.appearance?.normalAppearance?.takeIf { it.isStream }?.appearanceStream?.cosObject
                    if (own != null) drawOnAppearance(own, verdict)
                    else drawOnPage(doc, index, rect.lowerLeftX, rect.lowerLeftY, rect.width, rect.height, verdict)
                    changed = true
                }
            }
            if (!changed) null else { doc.save(out); out }
        }
    } catch (e: Throwable) {
        null
    }

    private fun read(doc: PDDocument): List<FieldMark> {
        val out = ArrayList<FieldMark>()
        eachSignature(doc) { sig, widget, index ->
            val br = sig.byteRange?.map { it.toLong() } ?: return@eachSignature
            val rect = widget.rectangle ?: return@eachSignature
            if (rect.width < 4f || rect.height < 4f) return@eachSignature // invisible signature
            val page = doc.getPage(index)
            val box = page.cropBox ?: page.mediaBox
            if (box.width <= 0f || box.height <= 0f) return@eachSignature
            val fx0 = ((rect.lowerLeftX - box.lowerLeftX) / box.width).coerceIn(0f, 1f)
            val fx1 = ((rect.upperRightX - box.lowerLeftX) / box.width).coerceIn(0f, 1f)
            val fy0 = ((box.upperRightY - rect.upperRightY) / box.height).coerceIn(0f, 1f)
            val fy1 = ((box.upperRightY - rect.lowerLeftY) / box.height).coerceIn(0f, 1f)
            val (a, b, c, d) = when (((page.rotation % 360) + 360) % 360) {
                90 -> listOf(1 - fy1, fx0, 1 - fy0, fx1)
                180 -> listOf(1 - fx1, 1 - fy1, 1 - fx0, 1 - fy0)
                270 -> listOf(fy0, 1 - fx1, fy1, 1 - fx0)
                else -> listOf(fx0, fy0, fx1, fy1)
            }
            out.add(FieldMark(br, index, a, b, c, d, hasLayers = layersOf(widget).isNotEmpty(), certified = isCertifying(sig)))
        }
        return out
    }

    private fun eachSignature(doc: PDDocument, action: (PDSignature, PDAnnotationWidget, Int) -> Unit) {
        val form = doc.documentCatalog.acroForm ?: return
        for (field in form.fieldTree) {
            if (field !is PDSignatureField) continue
            val sig = field.signature ?: continue
            for (widget in field.widgets) {
                var index = widget.page?.let { doc.pages.indexOf(it) } ?: -1
                if (index < 0) index = doc.pages.indexOfFirst { p -> p.annotations.any { it.cosObject == widget.cosObject } }
                if (index >= 0) action(sig, widget, index)
            }
        }
    }

    // ── validity layers ───────────────────────────────────────────────────────────

    private fun layersOf(widget: PDAnnotationWidget): List<Found> {
        val normal = widget.appearance?.normalAppearance ?: return emptyList()
        if (!normal.isStream) return emptyList()
        val out = ArrayList<Found>()
        collect(normal.appearanceStream.cosObject, 0, HashSet(), out)
        return out
    }

    private fun collect(stream: COSStream, depth: Int, seen: MutableSet<COSStream>, out: MutableList<Found>) {
        if (!seen.add(stream)) return
        layerKind(stream)?.let { out.add(Found(stream, it)); return }
        if (depth >= 6) return
        val xobjects = (stream.getDictionaryObject(COSName.RESOURCES) as? COSDictionary)
            ?.getDictionaryObject(COSName.XOBJECT) as? COSDictionary ?: return
        for (key in xobjects.keySet()) (xobjects.getDictionaryObject(key) as? COSStream)?.let { collect(it, depth + 1, seen, out) }
    }

    /** A form whose content opens with the marker comment `% DSUnknown`, `% DSValid` or `% DSInvalid`. */
    private fun layerKind(stream: COSStream): Layer? {
        if (stream.getNameAsString(COSName.SUBTYPE) != "Form") return null
        val head = try {
            stream.createInputStream().use { it.readNBytes(65536) }.toString(Charsets.ISO_8859_1)
        } catch (e: Exception) {
            return null
        }
        if (head.contains("(Signature Not Verified)")) return Layer.CAPTION
        return when (Regex("^\\s*% DS([A-Za-z]+)").find(head)?.groupValues?.get(1)) {
            "Unknown" -> Layer.UNKNOWN
            "Valid" -> Layer.VALID
            "Invalid" -> Layer.INVALID
            else -> null
        }
    }

    private fun redraw(stream: COSStream, verdict: MarkVerdict) {
        val bbox = (stream.getDictionaryObject(COSName.BBOX) as? COSArray)?.toFloatArray()
        val box = if (bbox != null && bbox.size == 4) bbox else floatArrayOf(0f, 0f, 100f, 100f)
        val x = minOf(box[0], box[2])
        val y = minOf(box[1], box[3])
        stream.createOutputStream(COSName.FLATE_DECODE).use {
            it.write(placed(verdict, x, y, Math.abs(box[2] - box[0]), Math.abs(box[3] - box[1])).toByteArray(Charsets.ISO_8859_1))
        }
        stream.setItem(COSName.RESOURCES, COSDictionary())
    }

    /** A box with an appearance but no verdict layer: the mark goes underneath it, so the signer's text stays on top. */
    private fun drawOnAppearance(stream: COSStream, verdict: MarkVerdict) {
        val bbox = (stream.getDictionaryObject(COSName.BBOX) as? COSArray)?.toFloatArray()
        val box = if (bbox != null && bbox.size == 4) bbox else floatArrayOf(0f, 0f, 100f, 100f)
        val existing = stream.createInputStream().use { it.readBytes() }
        val mark = placed(verdict, minOf(box[0], box[2]), minOf(box[1], box[3]), Math.abs(box[2] - box[0]), Math.abs(box[3] - box[1]))
        stream.createOutputStream(COSName.FLATE_DECODE).use {
            it.write(mark.toByteArray(Charsets.ISO_8859_1))
            it.write("\n".toByteArray())
            it.write(existing)
        }
    }

    /** A box with no appearance at all: the mark is written into the page instead. */
    private fun drawOnPage(doc: PDDocument, index: Int, x: Float, y: Float, w: Float, h: Float, verdict: MarkVerdict) {
        val page = doc.getPage(index)
        com.tom_roush.pdfbox.pdmodel.PDPageContentStream(
            doc, page, com.tom_roush.pdfbox.pdmodel.PDPageContentStream.AppendMode.APPEND, true, true,
        ).use { it.appendRawCommands(placed(verdict, x, y, w, h)) }
    }

    /** The mark drawn at its natural proportions, centred in the box. */
    private fun placed(verdict: MarkVerdict, x: Float, y: Float, w: Float, h: Float): String {
        val s = minOf(w, h) / 100f
        return "q $s 0 0 $s ${x + (w - 100f * s) / 2f} ${y + (h - 100f * s) / 2f} cm\n${glyph(verdict)}\nQ\n"
    }

    /**
     * The standard marks on a 100 x 100 square, in the style every reader uses: a bold fill colour
     * with a black outline and a black shadow to the lower right. The tick is green, the cross red,
     * and (where a box has no layer of its own) the question mark yellow.
     */
    private fun glyph(verdict: MarkVerdict): String = when (verdict) {
        MarkVerdict.VALID ->
            "q 0.88 0 0 0.88 1.9 10.6 cm " + solid(TICK, "0 0.70 0.25") + " Q"
        MarkVerdict.INVALID ->
            "q 1.15 0 0 1.15 -10.6 -4.3 cm " + solid(CROSS, "0.88 0.07 0.07") + " Q"
        MarkVerdict.UNKNOWN -> {
            val hook = "32 70 m 32 90 68 90 68 70 c 68 55 50 52 50 38 c"
            val dotOuter = "61 14 m 61 20.07 55.07 25 50 25 c 44.93 25 39 20.07 39 14 c 39 7.93 44.93 3 50 3 c 55.07 3 61 7.93 61 14 c f"
            val dotInner = "57.5 14 m 57.5 18.14 54.14 21.5 50 21.5 c 45.86 21.5 42.5 18.14 42.5 14 c 42.5 9.86 45.86 6.5 50 6.5 c 54.14 6.5 57.5 9.86 57.5 14 c f"
            "q 0.92 0 0 0.92 4 6 cm 1 J 1 j " +
                "q 1 0 0 1 5 -5 cm 0 G 0 g 20 w $hook S $dotOuter Q " +
                "0.15 0.12 0 RG 20 w $hook S 1 0.80 0 RG 12 w $hook S " +
                "0.15 0.12 0 rg $dotOuter 1 0.80 0 rg $dotInner Q"
        }
    }

    /** The tick as one outline: two bold arms with square ends, so the border runs all the way round. */
    private const val TICK = "0.89 39.37 m 43.67 -3.9 l 102.81 88.2 l 85.99 99 l 40.34 27.91 l 15.11 53.43 l h"

    /** The cross as one outline: two crossing bars, 12 corners. */
    private const val CROSS = "14.93 70.93 m 29.07 85.07 l 50 64.14 l 70.93 85.07 l 85.07 70.93 l 64.14 50 l 85.07 29.07 l 70.93 14.93 l 50 35.86 l 29.07 14.93 l 14.93 29.07 l 35.86 50 l h"

    /** A filled shape with a black border on every edge and a black shadow to its lower right. */
    private fun solid(path: String, rgb: String): String =
        "0 J 0 j q 1 0 0 1 5.25 -5.25 cm 0 g $path f Q $rgb rg 0 G 4.5 w $path B"
    /** A certifying signature carries a DocMDP reference. */
    private fun isCertifying(sig: PDSignature): Boolean {
        val refs = sig.cosObject.getDictionaryObject(COSName.getPDFName("Reference")) as? COSArray ?: return false
        for (i in 0 until refs.size()) {
            val ref = refs.getObject(i) as? COSDictionary ?: continue
            if (ref.getNameAsString(COSName.getPDFName("TransformMethod")) == "DocMDP") return true
        }
        return false
    }

    /** The caption layer with the signer's "(Signature Not Verified)" replaced by [text], on two lines when it holds an address. */
    private fun rewriteCaption(stream: COSStream, text: String): Boolean {
        val content = stream.createInputStream().use { it.readBytes() }.toString(Charsets.ISO_8859_1)
        val bbox = (stream.getDictionaryObject(COSName.BBOX) as? COSArray)?.toFloatArray()
        val replaced = captionContent(content, text, bbox) ?: return false
        stream.createOutputStream(COSName.FLATE_DECODE).use { it.write(replaced.toByteArray(Charsets.ISO_8859_1)) }
        return true
    }

    private fun captionContent(content: String, text: String, bbox: FloatArray?): String? {
        if (!content.contains("(Signature Not Verified)") || bbox == null || bbox.size != 4) return null
        val tf = content.indexOf(" Tf")
        if (tf < 0) return null
        val before = content.substring(0, tf).trimEnd().split(Regex("\\s+"))
        val size = before.lastOrNull()?.toFloatOrNull() ?: return null
        val font = before.getOrNull(before.size - 2) ?: return null
        if (!font.startsWith("/")) return null
        val x0 = minOf(bbox[0], bbox[2])
        val x1 = maxOf(bbox[0], bbox[2])
        val y0 = minOf(bbox[1], bbox[3])
        val y1 = maxOf(bbox[1], bbox[3])
        val split = text.indexOf(" <")
        val lines = if (split >= 0) listOf(text.substring(0, split), text.substring(split + 1)) else listOf(text)
        val longest = maxOf(1, lines.maxOf { it.codePointCount(0, it.length) })
        // Helvetica averages about 0.6 em per character, capitals and lower case mixed
        val fitted = maxOf(3f, minOf((x1 - x0 - 4f) / (longest * 0.6f), size))
        fun escape(line: String) = line.map { ch ->
            when {
                ch == '(' || ch == ')' || ch == '\\' -> "\\$ch"
                ch in ' '..'~' -> ch.toString()
                else -> "?"
            }
        }.joinToString("")
        val out = StringBuilder("BT\n")
        lines.forEachIndexed { i, line ->
            val y = maxOf(y1 - fitted * (i + 1), y0)
            out.append(font).append(' ').append(String.format(java.util.Locale.US, "%.2f", fitted))
                .append(" Tf 1 0 0 1 2 ").append(String.format(java.util.Locale.US, "%.2f", y))
                .append(" Tm (").append(escape(line)).append(") Tj\n")
        }
        return out.append("ET\n").toString()
    }
}
