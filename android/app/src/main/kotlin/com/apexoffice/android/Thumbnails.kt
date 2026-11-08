package com.apexoffice.android

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.util.LruCache
import com.apexoffice.android.docs.Docx
import com.apexoffice.android.pdf.OpenResult
import com.apexoffice.android.pdf.PdfDoc
import com.apexoffice.android.sheets.SheetsSession
import com.apexoffice.android.slides.Deck
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Semaphore

/**
 * Small page-1 pictures for the recent-files list. PDFs and slides draw their real first page;
 * documents, sheets and text files draw their first lines. Pictures are kept on disk and
 * regenerated when the file changes. Everything stays on the device.
 */
object Thumbnails {
    private val memory = object : LruCache<String, Bitmap>(24 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }
    private val failed = HashSet<String>()
    private val gate = Semaphore(2) // at most two files are opened for a preview at once

    /** Blocking; call off the main thread. Null when the file cannot be previewed. */
    fun load(context: Context, file: RecentFile, widthPx: Int = 240): Bitmap? {
        val uri = Uri.parse(file.uri)
        val key = file.uri + "|" + stamp(context, uri) + "|" + widthPx
        synchronized(this) {
            memory.get(key)?.let { return it }
            if (key in failed) return null
        }
        val dir = File(context.cacheDir, "thumbs").also { it.mkdirs() }
        val cached = File(dir, sha1(key) + ".png")
        if (cached.exists()) {
            BitmapFactory.decodeFile(cached.path)?.let { synchronized(this) { memory.put(key, it) }; return it }
        }
        gate.acquire()
        val bitmap: Bitmap? = try { generate(context, file, uri, widthPx) } catch (e: Throwable) { null } finally { gate.release() }
        if (bitmap == null) {
            synchronized(this) { failed.add(key) }
            return null
        }
        synchronized(this) { memory.put(key, bitmap) }
        runCatching { cached.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 90, it) } }
        // drop pictures of older versions of the same file
        dir.listFiles()?.filter { it.lastModified() < System.currentTimeMillis() - 30L * 24 * 3600 * 1000 }?.forEach { it.delete() }
        return bitmap
    }

    private fun stamp(context: Context, uri: Uri): String = runCatching {
        context.contentResolver.query(uri, arrayOf(DocumentsContract.Document.COLUMN_LAST_MODIFIED, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) "${if (c.isNull(0)) 0 else c.getLong(0)}:${if (c.isNull(1)) 0 else c.getLong(1)}" else "0"
        }
    }.getOrNull() ?: "0"

    private fun sha1(s: String) = MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

    private fun generate(context: Context, file: RecentFile, uri: Uri, w: Int): Bitmap? {
        val resolver = context.contentResolver
        return when (file.kind) {
            AppKind.PDF -> {
                val result = PdfDoc.open(resolver, uri, File(context.cacheDir, "thumb-open").also { it.mkdirs() }, null)
                if (result is OpenResult.Ok) try { result.doc.render(0, w) } finally { result.doc.close() } else null
            }
            AppKind.SLIDES -> {
                val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
                val deck = Deck.read(bytes)
                val slide = deck.slides.firstOrNull() ?: return null
                val bmp = Bitmap.createBitmap(w, (w * deck.height.toFloat() / deck.width).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
                deck.draw(Canvas(bmp), slide, w.toFloat())
                bmp
            }
            AppKind.DOCS -> {
                val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
                val text = Docx.read(bytes).text
                textPage(text.subSequence(0, minOf(text.length, 900)), w, (w * 1.3f).toInt(), monospace = false, size = w * 0.055f)
            }
            AppKind.SHEETS -> {
                val (session, _) = SheetsSession.open(resolver, uri, file.name)
                session ?: return null
                try { sheetPage(session, w) } finally { session.close() }
            }
            AppKind.MARKDOWN, AppKind.HTML -> {
                val text = resolver.openInputStream(uri)?.use { it.readNBytes(3000) }?.toString(Charsets.UTF_8) ?: return null
                textPage(text, w, (w * 1.3f).toInt(), monospace = true, size = w * 0.045f)
            }
            null -> null
        }
    }

    private fun textPage(text: CharSequence, w: Int, h: Int, monospace: Boolean, size: Float): Bitmap {
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        canvas.drawColor(Color.WHITE)
        val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#222222")
            textSize = size
            if (monospace) typeface = Typeface.MONOSPACE
        }
        val pad = w * 0.09f
        val layout = StaticLayout.Builder.obtain(text, 0, text.length, paint, (w - 2 * pad).toInt()).setAlignment(Layout.Alignment.ALIGN_NORMAL).build()
        canvas.save()
        canvas.clipRect(0f, 0f, w.toFloat(), h.toFloat())
        canvas.translate(pad, pad)
        layout.draw(canvas)
        canvas.restore()
        return bmp
    }

    private fun sheetPage(session: SheetsSession, w: Int): Bitmap {
        val cols = 4
        val rows = 9
        val h = (w * 1.0f).toInt()
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        canvas.drawColor(Color.WHITE)
        val cells = session.readBlock(0, 1, 1, rows, cols)
        val cw = w / cols.toFloat()
        val rh = h / rows.toFloat()
        val line = Paint().apply { color = Color.parseColor("#D8DEDA"); strokeWidth = 1f }
        val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { textSize = rh * 0.42f; color = Color.parseColor("#222222") }
        for (r in 0 until rows) {
            canvas.drawLine(0f, (r + 1) * rh, w.toFloat(), (r + 1) * rh, line)
            for (c in 0 until cols) {
                val cell = cells[SheetsSession.key(r + 1, c + 1)] ?: continue
                if (cell.fill != null) { paint.style = Paint.Style.FILL; val f = Paint().apply { color = cell.fill }; canvas.drawRect(c * cw, r * rh, (c + 1) * cw, (r + 1) * rh, f) }
                paint.isFakeBoldText = cell.bold
                val shown = TextUtilsEllipsize(cell.text, paint, cw - 8f)
                canvas.drawText(shown, c * cw + 4f, r * rh + rh * 0.68f, paint)
            }
        }
        for (c in 1 until cols) canvas.drawLine(c * cw, 0f, c * cw, h.toFloat(), line)
        return bmp
    }

    private fun TextUtilsEllipsize(text: String, paint: TextPaint, width: Float): String =
        android.text.TextUtils.ellipsize(text, paint, width, android.text.TextUtils.TruncateAt.END).toString()
}
