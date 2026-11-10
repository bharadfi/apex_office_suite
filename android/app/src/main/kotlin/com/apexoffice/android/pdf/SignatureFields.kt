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
     * and (where a box has no layer of its own) the question mark pale yellow.
     */
    private fun glyph(verdict: MarkVerdict): String = when (verdict) {
        MarkVerdict.VALID ->
            "q 0.88 0 0 0.88 1.9 10.6 cm " + solid(TICK, "0 0.70 0.25", 5.1f) + " Q"
        // pure red, a thin black border all round, and a black shadow 2 units to the lower right
        MarkVerdict.INVALID ->
            "0 J 0 j q 1 0 0 1 2 -2 cm 0 g 0 G 1.8 w $CROSS B Q 0 G 1.8 w $CROSS S 1 0 0 rg $CROSS f"
        MarkVerdict.UNKNOWN -> QUESTION_MARK
    }

    /** The tick as one outline: two bold arms with square ends, so the border runs all the way round. */
    private const val TICK = "0.89 39.37 m 43.67 -3.9 l 102.81 88.2 l 85.99 99 l 40.34 27.91 l 15.11 53.43 l h"

    /** The cross as one outline, traced from the standard red cross: two crossing bars, 12 corners. */
    private const val CROSS = "50 64.59 m 70.94 87.41 l 81.92 76.15 l 62.28 50.72 l 84.81 22.12 l 71.52 9.41 l 50 35.41 l 28.48 9.41 l 15.19 22.12 l 37.72 50.72 l 18.08 76.15 l 29.06 87.41 l h"

    /**
     * The standard "not checked" question mark, exactly as signing software draws it in its own
     * validity layer: pale yellow, a hairline border, and a black shadow 2.6 units to the lower right.
     */
    private const val QUESTION_MARK =
        "q 0.1 0 0 0.1 9 0 cm 0 J 0 j 4 M [] 0 d 1 i 0 g " +
            "313 292 m 313 404 325 453 432 529 c 478 561 504 597 504 645 c 504 736 440 760 391 760 c 286 760 271 681 265 626 c 265 625 l 100 625 l 100 828 253 898 381 898 c 451 898 679 878 679 650 c 679 555 628 499 538 435 c 488 399 467 376 467 292 c 313 292 l h 308 214 170 -164 re f " +
            "0.44 G 1.2 w 1 1 0.4 rg " +
            "287 318 m 287 430 299 479 406 555 c 451 587 478 623 478 671 c 478 762 414 786 365 786 c 260 786 245 707 239 652 c 239 651 l 74 651 l 74 854 227 924 355 924 c 425 924 653 904 653 676 c 653 581 602 525 512 461 c 462 425 441 402 441 318 c 287 318 l h 282 240 170 -164 re B Q"

    /** The tick: a filled shape with a black border on every edge and a black shadow to its lower right. */
    private fun solid(path: String, rgb: String, shadow: Float): String =
        "0 J 0 j q 1 0 0 1 $shadow -$shadow cm 0 g $path f Q $rgb rg 0 G 4.5 w $path B"
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
