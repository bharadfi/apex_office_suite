package com.apexoffice.android

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns

data class RecentFile(val uri: String, val name: String, val openedAt: Long) {
    val kind: AppKind? get() = Formats.kindFor(name)
}

/** The most recently opened documents, kept in private preferences (one tab-separated line each). */
class RecentFiles(context: Context) {
    private val prefs = context.getSharedPreferences("recent_files", Context.MODE_PRIVATE)
    private val resolver = context.contentResolver

    fun all(): List<RecentFile> =
        (prefs.getString(KEY, "") ?: "").lineSequence().mapNotNull { line ->
            val parts = line.split('\t')
            if (parts.size == 3) parts[2].toLongOrNull()?.let { RecentFile(parts[0], parts[1], it) } else null
        }.toList()

    fun displayName(uri: Uri): String =
        runCatching {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        }.getOrNull() ?: uri.lastPathSegment ?: "Untitled"

    fun add(uri: Uri): RecentFile {
        val entry = RecentFile(uri.toString(), displayName(uri), System.currentTimeMillis())
        val next = (listOf(entry) + all().filter { it.uri != entry.uri }).take(MAX)
        prefs.edit().putString(KEY, next.joinToString("\n") { "${it.uri}\t${it.name.replace('\t', ' ')}\t${it.openedAt}" }).apply()
        return entry
    }

    fun remove(uri: String) {
        val next = all().filter { it.uri != uri }
        prefs.edit().putString(KEY, next.joinToString("\n") { "${it.uri}\t${it.name}\t${it.openedAt}" }).apply()
    }

    private companion object {
        const val KEY = "items"
        const val MAX = 50
    }
}
