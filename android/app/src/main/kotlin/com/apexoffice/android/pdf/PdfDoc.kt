package com.apexoffice.android.pdf

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.LoadParams
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import java.io.File

sealed interface OpenResult {
    data class Ok(val doc: PdfDoc) : OpenResult
    data object NeedsPassword : OpenResult
    data class Failed(val message: String) : OpenResult
}

/**
 * A PDF opened with Android's built-in renderer. The renderer allows one open page at a
 * time, so every call is serialised.
 */
class PdfDoc private constructor(
    private val renderer: PdfRenderer,
    private val fd: ParcelFileDescriptor,
    val pageCount: Int,
    /** page height divided by page width, per page */
    val ratios: FloatArray,
) {
    private val lock = Any()

    fun render(index: Int, widthPx: Int, background: Int = Color.WHITE): Bitmap = synchronized(lock) {
        renderer.openPage(index).use { page ->
            val w = widthPx.coerceIn(64, 4096)
            val h = (w * page.height.toFloat() / page.width).toInt().coerceAtLeast(1)
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            bmp.eraseColor(background)
            page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            bmp
        }
    }

    fun close() = synchronized(lock) {
        runCatching { renderer.close() }
        runCatching { fd.close() }
    }

    companion object {
        /** Password-protected files need Android 15 or newer from the system renderer. */
        val supportsPasswords: Boolean get() = Build.VERSION.SDK_INT >= 35

        fun open(resolver: ContentResolver, uri: Uri, cacheDir: File, password: String?): OpenResult {
            var pfd = try {
                resolver.openFileDescriptor(uri, "r")
            } catch (e: Exception) {
                null
            }
            // the renderer needs a seekable descriptor; copy when the provider streams
            if (pfd == null || runCatching { android.system.Os.lseek(pfd.fileDescriptor, 0, android.system.OsConstants.SEEK_SET) }.isFailure) {
                pfd?.close()
                pfd = try {
                    val copy = File(cacheDir, "open.pdf")
                    resolver.openInputStream(uri)?.use { input -> copy.outputStream().use { input.copyTo(it) } }
                    ParcelFileDescriptor.open(copy, ParcelFileDescriptor.MODE_READ_ONLY)
                } catch (e: Exception) {
                    return OpenResult.Failed("The file could not be read.")
                }
            }
            return try {
                val renderer = if (Build.VERSION.SDK_INT >= 35 && password != null) {
                    PdfRenderer(pfd!!, LoadParams.Builder().setPassword(password).build())
                } else PdfRenderer(pfd!!)
                val count = renderer.pageCount
                val ratios = FloatArray(count) { i ->
                    renderer.openPage(i).use { it.height.toFloat() / it.width }
                }
                OpenResult.Ok(PdfDoc(renderer, pfd, count, ratios))
            } catch (e: SecurityException) {
                pfd?.close()
                OpenResult.NeedsPassword
            } catch (e: Exception) {
                pfd?.close()
                OpenResult.Failed(e.message ?: "This PDF could not be opened.")
            }
        }
    }
}
