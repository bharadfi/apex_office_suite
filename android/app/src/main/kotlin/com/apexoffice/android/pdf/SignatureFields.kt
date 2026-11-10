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
)

/**
 * Reads the signature fields from the PDF structure so each can be marked on its page, and builds
 * the copy that is DISPLAYED: the signer's own "unknown" layers redrawn to the real verdict, as
 * the desktop app does. The signed file is never changed; verification always reads its own bytes.
 */
object SignatureFields {
    private enum class Layer { UNKNOWN, VALID, INVALID }
    private class Found(val stream: COSStream, val kind: Layer)

    fun locate(context: Context, bytes: ByteArray): List<FieldMark> = try {
        PDFBoxResourceLoader.init(context.applicationContext)
        PDDocument.load(bytes).use { doc -> read(doc) }
    } catch (e: Throwable) {
        emptyList() // encrypted or unusual files: the banner and the Tools sheet still report the signatures
    }

    /**
     * A copy of the file with each verdict layer redrawn to [verdicts] (keyed by the signature's
     * byte range), or null when no signature box has such a layer.
     */
    fun display(context: Context, bytes: ByteArray, verdicts: Map<List<Long>, MarkVerdict>, out: File): File? = try {
        PDFBoxResourceLoader.init(context.applicationContext)
        PDDocument.load(bytes).use { doc ->
            var changed = false
            eachSignature(doc) { sig, widget, _ ->
                val verdict = verdicts[sig.byteRange.map { it.toLong() }] ?: return@eachSignature
                val done = HashSet<COSStream>()
                for (layer in layersOf(widget)) {
                    if (!done.add(layer.stream)) continue
                    redraw(layer.stream, verdict)
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
            out.add(FieldMark(br, index, a, b, c, d, hasLayers = layersOf(widget).isNotEmpty()))
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
        if (head.contains("(Signature Not Verified)")) return null // the caption layer is left as the signer wrote it
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
        stream.createOutputStream(COSName.FLATE_DECODE).use { it.write(content(verdict, box).toByteArray(Charsets.ISO_8859_1)) }
        val state = { alpha: Float ->
            COSDictionary().apply {
                setItem(COSName.TYPE, COSName.getPDFName("ExtGState"))
                setFloat(COSName.getPDFName("ca"), alpha)
                setFloat(COSName.getPDFName("CA"), alpha)
            }
        }
        val resources = COSDictionary().apply {
            setItem(COSName.getPDFName("ExtGState"), COSDictionary().apply {
                setItem(COSName.getPDFName("DSA"), state(0.28f))
                setItem(COSName.getPDFName("DSB"), state(1f))
            })
            if (verdict == MarkVerdict.UNKNOWN) {
                setItem(COSName.FONT, COSDictionary().apply {
                    setItem(COSName.getPDFName("DSF"), COSDictionary().apply {
                        setItem(COSName.TYPE, COSName.FONT)
                        setItem(COSName.SUBTYPE, COSName.getPDFName("Type1"))
                        setItem(COSName.BASE_FONT, COSName.getPDFName("Helvetica-Bold"))
                    })
                })
            }
        }
        stream.setItem(COSName.RESOURCES, resources)
    }

    /** Adobe lays a verdict layer out on a 100 x 100 square: a translucent round badge holding the glyph. */
    private fun content(verdict: MarkVerdict, bbox: FloatArray): String {
        val (marker, rgb, glyph) = when (verdict) {
            MarkVerdict.VALID -> Triple("% DSValid", "0.0 0.5 0.18", "9 w 30 50 m 45 34 l 72 68 l S")
            MarkVerdict.INVALID -> Triple("% DSInvalid", "0.75 0.1 0.1", "9 w 33 33 m 67 67 l S 33 67 m 67 33 l S")
            MarkVerdict.UNKNOWN -> Triple("% DSUnknown", "0.75 0.38 0.0", "BT /DSF 62 Tf 31 30 Td (?) Tj ET")
        }
        val sx = Math.abs(bbox[2] - bbox[0]) / 100f
        val sy = Math.abs(bbox[3] - bbox[1]) / 100f
        return listOf(
            marker,
            "q $sx 0 0 $sy ${minOf(bbox[0], bbox[2])} ${minOf(bbox[1], bbox[3])} cm 1 J 1 j",
            "/DSA gs $rgb rg 94 50 m 94 74.3 74.3 94 50 94 c 25.7 94 6 74.3 6 50 c 6 25.7 25.7 6 50 6 c 74.3 6 94 25.7 94 50 c f",
            "/DSB gs $rgb RG $rgb rg $glyph",
            "Q",
        ).joinToString("") { "$it\n" }
    }
}
