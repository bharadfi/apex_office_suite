package com.apexoffice.android.sheets

/** Bindings to libapex_sheets_core (IronCalc). Rows and columns are 1-based; sheets are 0-based. */
object NativeSheets {
    init {
        System.loadLibrary("apex_sheets_core")
    }

    external fun nativeOpen(bytes: ByteArray): Long
    external fun nativeNew(): Long
    external fun nativeLastError(): String
    external fun nativeClose(handle: Long)
    external fun nativeSheetNames(handle: Long): String
    external fun nativeAddSheet(handle: Long, name: String): Boolean
    external fun nativeDimension(handle: Long, sheet: Int): String
    external fun nativeRange(handle: Long, sheet: Int, row0: Int, col0: Int, row1: Int, col1: Int): String
    external fun nativeInput(handle: Long, sheet: Int, row: Int, col: Int): String
    external fun nativeSetInput(handle: Long, sheet: Int, row: Int, col: Int, text: String): Boolean
    external fun nativeColumnWidth(handle: Long, sheet: Int, col: Int): Double
    external fun nativeRowHeight(handle: Long, sheet: Int, row: Int): Double
    external fun nativeSave(handle: Long): ByteArray?
    /** op: 0 insert rows, 1 delete rows, 2 insert columns, 3 delete columns */
    external fun nativeEdit(handle: Long, sheet: Int, op: Int, index: Int, count: Int): Boolean
}
