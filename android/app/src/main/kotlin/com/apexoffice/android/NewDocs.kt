package com.apexoffice.android

import android.text.SpannableStringBuilder
import com.apexoffice.android.docs.Docx
import com.apexoffice.android.sheets.NativeSheets

/** Blank documents the home screen can create. Slides and PDF are open-only for now. */
object NewDocs {
    class Spec(val mime: String, val fileName: String)

    val specs: Map<AppKind, Spec> = mapOf(
        AppKind.DOCS to Spec("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Untitled.docx"),
        AppKind.SHEETS to Spec("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Untitled.xlsx"),
        AppKind.MARKDOWN to Spec("text/markdown", "Untitled.md"),
        AppKind.HTML to Spec("text/html", "Untitled.html"),
    )

    fun bytes(kind: AppKind): ByteArray? = when (kind) {
        AppKind.DOCS -> Docx.write(SpannableStringBuilder(""))
        AppKind.SHEETS -> {
            val handle = NativeSheets.nativeNew()
            if (handle == 0L) null else try { NativeSheets.nativeSave(handle) } finally { NativeSheets.nativeClose(handle) }
        }
        AppKind.MARKDOWN -> "# Untitled\n\n".toByteArray()
        AppKind.HTML -> "<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n<title>Untitled</title>\n</head>\n<body>\n<h1>Untitled</h1>\n</body>\n</html>\n".toByteArray()
        else -> null
    }
}
