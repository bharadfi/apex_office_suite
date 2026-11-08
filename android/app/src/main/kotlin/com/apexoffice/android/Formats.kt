package com.apexoffice.android

/** The six editors of Apex Office, in home-screen order. */
enum class AppKind(val title: String, val extensionHint: String, val stage: Int) {
    DOCS("Docs", ".docx", 4),
    SHEETS("Sheets", ".xlsx", 2),
    SLIDES("Slides", ".pptx", 5),
    PDF("PDF", ".pdf", 3),
    MARKDOWN("Markdown", ".md", 5),
    HTML("HTML", ".html", 5),
}

/**
 * Extension routing, mirroring the desktop app's open-file lists so a file that
 * opens on Windows is claimed by the same editor here.
 */
object Formats {
    private val byExtension: Map<String, AppKind> = buildMap {
        for (e in listOf("docx", "docm", "dotx", "dotm", "doc", "dot", "rtf", "odt", "ott", "hwp", "hwpx"))
            put(e, AppKind.DOCS)
        for (e in listOf("xlsx", "xlsm", "xlsb", "xltx", "xltm", "xlam", "xls", "csv", "tsv", "ods", "ots", "vcf"))
            put(e, AppKind.SHEETS)
        for (e in listOf("pptx", "pptm", "ppsx", "ppsm", "potx", "potm", "ppt", "odp", "otp"))
            put(e, AppKind.SLIDES)
        put("pdf", AppKind.PDF)
        for (e in listOf("md", "markdown", "txt", "json")) put(e, AppKind.MARKDOWN)
        for (e in listOf("html", "htm")) put(e, AppKind.HTML)
    }

    fun extensionOf(name: String): String =
        name.substringAfterLast('.', "").lowercase()

    fun kindFor(name: String): AppKind? = byExtension[extensionOf(name)]

    /** MIME types offered to the system file picker (the picker filters loosely; routing is by extension). */
    val pickerMimeTypes = arrayOf("*/*")
}
