package com.apexoffice.android.pdf

import android.content.Context
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.interactive.digitalsignature.PDSignature
import com.tom_roush.pdfbox.pdmodel.interactive.form.PDSignatureField

/** Where a signature's visible area sits on a page, as fractions of the page as displayed (0..1, top-left origin). */
class FieldMark(val byteRange: List<Long>, val page: Int, val x0: Float, val y0: Float, val x1: Float, val y1: Float)

/** Reads the signature fields from the PDF structure so each can be marked on its page. */
object SignatureFields {
    fun locate(context: Context, bytes: ByteArray): List<FieldMark> = try {
        PDFBoxResourceLoader.init(context.applicationContext)
        PDDocument.load(bytes).use { doc -> read(doc) }
    } catch (e: Throwable) {
        emptyList() // encrypted or unusual files: the banner and the Tools sheet still report the signatures
    }

    private fun read(doc: PDDocument): List<FieldMark> {
        val form = doc.documentCatalog.acroForm ?: return emptyList()
        val out = ArrayList<FieldMark>()
        for (field in form.fieldTree) {
            if (field !is PDSignatureField) continue
            val sig: PDSignature = field.signature ?: continue
            val br = sig.byteRange?.map { it.toLong() } ?: continue
            for (widget in field.widgets) {
                val rect = widget.rectangle ?: continue
                if (rect.width < 4f || rect.height < 4f) continue // invisible signature
                var index = widget.page?.let { doc.pages.indexOf(it) } ?: -1
                if (index < 0) index = doc.pages.indexOfFirst { p -> p.annotations.any { it.cosObject == widget.cosObject } }
                if (index < 0) continue
                val page = doc.getPage(index)
                val box = page.cropBox ?: page.mediaBox
                if (box.width <= 0f || box.height <= 0f) continue
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
                out.add(FieldMark(br, index, a, b, c, d))
            }
        }
        return out
    }
}
