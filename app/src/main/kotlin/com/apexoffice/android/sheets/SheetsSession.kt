package com.apexoffice.android.sheets

import android.content.ContentResolver
import android.net.Uri
import com.apexoffice.android.Formats

class Cell(
    val text: String,
    val bold: Boolean,
    val italic: Boolean,
    val underline: Boolean,
    val fill: Int?,
    val color: Int?,
    val align: Char,
)

/** One open workbook: reads cells in blocks, applies edits, and serialises back to xlsx. */
class SheetsSession private constructor(
    private val handle: Long,
    val displayName: String,
    /** true when the file was converted from csv/tsv/vcf: saving needs a new .xlsx name */
    val needsSaveAs: Boolean,
) {
    var sheetNames: List<String> = emptyList()
        private set
    private val dimension = HashMap<Int, Pair<Int, Int>>()

    init {
        refreshSheets()
    }

    fun refreshSheets() {
        sheetNames = NativeSheets.nativeSheetNames(handle).split('\n').filter { it.isNotEmpty() }
    }

    fun addSheet(): Boolean {
        var n = sheetNames.size + 1
        while ("Sheet$n" in sheetNames) n++
        val ok = NativeSheets.nativeAddSheet(handle, "Sheet$n")
        if (ok) refreshSheets()
        return ok
    }

    /** Rows and columns in use (at least 1 x 1). */
    fun used(sheet: Int): Pair<Int, Int> = dimension.getOrPut(sheet) {
        val parts = NativeSheets.nativeDimension(handle, sheet).split(',')
        (parts.getOrNull(0)?.toIntOrNull() ?: 1) to (parts.getOrNull(1)?.toIntOrNull() ?: 1)
    }

    fun columnWidthDp(sheet: Int, col: Int): Float =
        (NativeSheets.nativeColumnWidth(handle, sheet, col).toFloat() * 0.8f).coerceIn(44f, 320f)

    fun rowHeightDp(sheet: Int, row: Int): Float =
        (NativeSheets.nativeRowHeight(handle, sheet, row).toFloat()).coerceIn(24f, 160f)

    fun readBlock(sheet: Int, row0: Int, col0: Int, row1: Int, col1: Int): Map<Long, Cell> {
        val raw = NativeSheets.nativeRange(handle, sheet, row0, col0, row1, col1)
        val out = HashMap<Long, Cell>()
        if (raw.isEmpty()) return out
        raw.split('\u001c').forEachIndexed { ri, rowText ->
            rowText.split("\u001e\u001d").forEachIndexed { ci, cellText ->
                val f = cellText.split('\u001f')
                if (f.size >= 5) {
                    val flags = f[1].toIntOrNull() ?: 0
                    val text = f[0]
                    val fill = parseColor(f[2])
                    if (text.isNotEmpty() || flags != 0 || fill != null || f[4].isNotEmpty()) {
                        out[key(row0 + ri, col0 + ci)] = Cell(
                            text, flags and 1 != 0, flags and 2 != 0, flags and 4 != 0,
                            fill, parseColor(f[3]), f[4].firstOrNull() ?: ' ',
                        )
                    }
                }
            }
        }
        return out
    }

    fun input(sheet: Int, row: Int, col: Int): String = NativeSheets.nativeInput(handle, sheet, row, col)

    fun setInput(sheet: Int, row: Int, col: Int, text: String): Boolean {
        snapshot()
        val ok = NativeSheets.nativeSetInput(handle, sheet, row, col, text)
        if (ok) dimension.remove(sheet)
        return ok
    }

    fun edit(sheet: Int, op: Int, index: Int, count: Int = 1): Boolean {
        snapshot()
        val ok = NativeSheets.nativeEdit(handle, sheet, op, index, count)
        if (ok) dimension.remove(sheet)
        return ok
    }

    /** Call before a change so it can be undone. */
    fun snapshot() = NativeSheets.nativeSnapshot(handle)

    fun undo(): Boolean = NativeSheets.nativeUndo(handle).also { if (it) dimension.clear() }
    fun redo(): Boolean = NativeSheets.nativeRedo(handle).also { if (it) dimension.clear() }

    fun style(sheet: Int, row: Int, col: Int, prop: Int, value: Int = 0): Boolean {
        snapshot()
        return NativeSheets.nativeStyle(handle, sheet, row, col, prop, value)
    }

    /** Current width in the engine's units, then set to [width]. */
    fun resizeColumn(sheet: Int, col: Int, factor: Double): Boolean {
        val current = NativeSheets.nativeColumnWidth(handle, sheet, col)
        snapshot()
        return NativeSheets.nativeSetColumnWidth(handle, sheet, col, (current * factor).coerceIn(30.0, 600.0))
    }

    fun lastError(): String = NativeSheets.nativeLastError()

    fun toXlsx(): ByteArray? = NativeSheets.nativeSave(handle)

    fun close() = NativeSheets.nativeClose(handle)

    companion object {
        fun key(row: Int, col: Int): Long = row.toLong() shl 20 or col.toLong()

        private fun parseColor(hex: String): Int? =
            if (hex.length == 7 && hex[0] == '#') hex.substring(1).toIntOrNull(16)?.let { 0xFF000000.toInt() or it } else null

        /** Opens any supported spreadsheet-like file; null with [error] set on failure. */
        fun open(resolver: ContentResolver, uri: Uri, name: String): Pair<SheetsSession?, String?> {
            val bytes = try {
                resolver.openInputStream(uri)?.use { it.readBytes() }
            } catch (e: Exception) {
                null
            } ?: return null to "The file could not be read."
            return when (Formats.extensionOf(name)) {
                "xlsx", "xlsm" -> {
                    val h = NativeSheets.nativeOpen(bytes)
                    if (h == 0L) null to NativeSheets.nativeLastError().ifBlank { "This workbook could not be opened." }
                    else SheetsSession(h, name, needsSaveAs = false) to null
                }
                "csv", "tsv", "vcf" -> fromTable(name, bytes)
                else -> null to "Opening .${Formats.extensionOf(name)} files in Sheets is not available yet."
            }
        }

        private fun fromTable(name: String, bytes: ByteArray): Pair<SheetsSession?, String?> {
            val text = String(bytes, Charsets.UTF_8)
            val ext = Formats.extensionOf(name)
            val rows = when (ext) {
                "tsv" -> parseDelimited(text, '\t')
                "vcf" -> Vcf.toRows(text)
                else -> parseDelimited(text, if (text.lineSequence().firstOrNull()?.count { it == ';' }.let { (it ?: 0) > (text.lineSequence().firstOrNull()?.count { c -> c == ',' } ?: 0) }) ';' else ',')
            }
            val h = NativeSheets.nativeNew()
            if (h == 0L) return null to NativeSheets.nativeLastError()
            rows.forEachIndexed { r, row ->
                row.forEachIndexed { c, value -> if (value.isNotEmpty()) NativeSheets.nativeSetInput(h, 0, r + 1, c + 1, value) }
            }
            val stem = name.substringBeforeLast('.')
            return SheetsSession(h, "$stem.xlsx", needsSaveAs = true) to null
        }

        fun parseDelimited(text: String, delimiter: Char): List<List<String>> {
            val rows = ArrayList<List<String>>()
            var row = ArrayList<String>()
            val cell = StringBuilder()
            var quoted = false
            val s = text.removePrefix("﻿")
            var i = 0
            while (i < s.length) {
                val ch = s[i]
                when {
                    quoted && ch == '"' && s.getOrNull(i + 1) == '"' -> { cell.append('"'); i++ }
                    quoted && ch == '"' -> quoted = false
                    quoted -> cell.append(ch)
                    ch == '"' -> quoted = true
                    ch == delimiter -> { row.add(cell.toString()); cell.setLength(0) }
                    ch == '\n' || ch == '\r' -> {
                        if (ch == '\r' && s.getOrNull(i + 1) == '\n') i++
                        row.add(cell.toString()); cell.setLength(0)
                        rows.add(row); row = ArrayList()
                    }
                    else -> cell.append(ch)
                }
                i++
            }
            if (cell.isNotEmpty() || row.isNotEmpty()) { row.add(cell.toString()); rows.add(row) }
            return rows
        }
    }
}
