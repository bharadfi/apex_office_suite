package com.apexoffice.android

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

enum class ThemeMode(val label: String) { SYSTEM("System"), LIGHT("Light"), DARK("Dark") }

/** App settings kept in private preferences. The theme follows the system until the user picks one. */
object Prefs {
    private const val FILE = "settings"
    var theme by mutableStateOf(ThemeMode.SYSTEM)
        private set

    fun load(context: Context) {
        val saved = context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString("theme", null)
        theme = ThemeMode.entries.firstOrNull { it.name == saved } ?: ThemeMode.SYSTEM
    }

    fun setTheme(context: Context, mode: ThemeMode) {
        theme = mode
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString("theme", mode.name).apply()
    }
}
