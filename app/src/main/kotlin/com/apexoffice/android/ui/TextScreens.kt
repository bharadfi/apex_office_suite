package com.apexoffice.android.ui

import android.annotation.SuppressLint
import android.graphics.Color as AColor
import android.net.Uri
import android.text.InputType
import android.text.method.LinkMovementMethod
import android.view.Gravity
import android.webkit.WebView
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.apexoffice.android.Formats
import com.apexoffice.android.docs.Markdown
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private const val MAX_TEXT_BYTES = 8 * 1024 * 1024

private suspend fun readText(context: android.content.Context, uri: Uri): Result<String> = withContext(Dispatchers.IO) {
    runCatching {
        val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: error("The file could not be read.")
        if (bytes.size > MAX_TEXT_BYTES) error("This file is larger than 8 MB and is too big to edit here.")
        String(bytes, Charsets.UTF_8)
    }
}

private fun writeText(context: android.content.Context, uri: Uri, text: String): Boolean = try {
    context.contentResolver.openOutputStream(uri, "wt")?.use { it.write(text.toByteArray(Charsets.UTF_8)) } != null
} catch (e: Exception) {
    false
}

/** Markdown, plain text and JSON: edit the raw text, and preview Markdown rendered. */
@Composable
fun MarkdownScreen(uri: Uri, name: String, onClose: () -> Unit) {
    val context = LocalContext.current
    val isMarkdown = Formats.extensionOf(name).let { it == "md" || it == "markdown" }
    var text by remember { mutableStateOf<String?>(null) }
    var current by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var preview by remember { mutableStateOf(false) }
    var dirty by remember { mutableStateOf(false) }
    var askLeave by remember { mutableStateOf(false) }

    LaunchedEffect(uri) {
        readText(context, uri).onSuccess { text = it; current = it }.onFailure { error = it.message }
    }
    fun save() {
        val ok = writeText(context, uri, current)
        Toast.makeText(context, if (ok) "Saved" else "Could not save this file", Toast.LENGTH_SHORT).show()
        if (ok) dirty = false
    }
    BackHandler { if (dirty) askLeave = true else onClose() }

    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
        TopBar(name, dirty, onBack = { if (dirty) askLeave = true else onClose() }, onSave = { save() }, canSave = text != null)
        if (isMarkdown) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (preview) OutlinedButton(onClick = { preview = false }) { Text("Edit") } else FilledTonalButton(onClick = { preview = false }) { Text("Edit") }
                if (preview) FilledTonalButton(onClick = { preview = true }) { Text("Preview") } else OutlinedButton(onClick = { preview = true }) { Text("Preview") }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
        }
        when {
            error != null -> ErrorBox(error!!, onClose)
            text == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Opening…") }
            isMarkdown && preview -> Box(Modifier.fillMaxSize().background(Color(0xFFE4E7E5)), contentAlignment = Alignment.TopCenter) {
                AndroidView(
                    modifier = Modifier.widthIn(max = 820.dp).fillMaxSize(),
                    factory = { ctx -> TextView(ctx).apply {
                        val pad = (16 * resources.displayMetrics.density).toInt()
                        setPadding(pad, pad, pad, pad); setBackgroundColor(AColor.WHITE); setTextColor(AColor.BLACK)
                        textSize = 16f; movementMethod = LinkMovementMethod.getInstance(); setTextIsSelectable(true)
                    } },
                    update = { it.text = Markdown.render(current) },
                )
            }
            else -> Box(Modifier.fillMaxSize().background(Color(0xFFE4E7E5)), contentAlignment = Alignment.TopCenter) {
                AndroidView(
                    modifier = Modifier.widthIn(max = 820.dp).fillMaxSize(),
                    factory = { ctx -> EditText(ctx).apply {
                        val pad = (16 * resources.displayMetrics.density).toInt()
                        setPadding(pad, pad, pad, pad * 4); setBackgroundColor(AColor.WHITE); setTextColor(AColor.BLACK)
                        typeface = android.graphics.Typeface.MONOSPACE; textSize = 14f
                        gravity = Gravity.TOP or Gravity.START
                        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
                        setText(text)
                        addTextChangedListener(object : android.text.TextWatcher {
                            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                            override fun afterTextChanged(e: android.text.Editable) { current = e.toString(); dirty = current != text }
                        })
                    } },
                )
            }
        }
    }
    LeaveDialog(askLeave, { askLeave = false }, onSave = { askLeave = false; save() }, onDiscard = { askLeave = false; onClose() })
}

/** HTML: a sandboxed preview (no scripts, no network) and the source to edit. */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun HtmlScreen(uri: Uri, name: String, onClose: () -> Unit) {
    val context = LocalContext.current
    var text by remember { mutableStateOf<String?>(null) }
    var current by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var showSource by remember { mutableStateOf(false) }
    var dirty by remember { mutableStateOf(false) }
    var askLeave by remember { mutableStateOf(false) }

    LaunchedEffect(uri) { readText(context, uri).onSuccess { text = it; current = it }.onFailure { error = it.message } }
    fun save() {
        val ok = writeText(context, uri, current)
        Toast.makeText(context, if (ok) "Saved" else "Could not save this file", Toast.LENGTH_SHORT).show()
        if (ok) dirty = false
    }
    BackHandler { if (dirty) askLeave = true else onClose() }

    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
        TopBar(name, dirty, onBack = { if (dirty) askLeave = true else onClose() }, onSave = { save() }, canSave = text != null)
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (showSource) OutlinedButton(onClick = { showSource = false }) { Text("Preview") } else FilledTonalButton(onClick = { showSource = false }) { Text("Preview") }
            if (showSource) FilledTonalButton(onClick = { showSource = true }) { Text("Source") } else OutlinedButton(onClick = { showSource = true }) { Text("Source") }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
        when {
            error != null -> ErrorBox(error!!, onClose)
            text == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Opening…") }
            showSource -> AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx -> EditText(ctx).apply {
                    val pad = (16 * resources.displayMetrics.density).toInt()
                    setPadding(pad, pad, pad, pad * 4); setBackgroundColor(AColor.WHITE); setTextColor(AColor.BLACK)
                    typeface = android.graphics.Typeface.MONOSPACE; textSize = 13f
                    gravity = Gravity.TOP or Gravity.START
                    inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
                    setText(current)
                    addTextChangedListener(object : android.text.TextWatcher {
                        override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                        override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                        override fun afterTextChanged(e: android.text.Editable) { current = e.toString(); dirty = current != text }
                    })
                } },
            )
            else -> AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx -> WebView(ctx).apply {
                    // preview only: no scripts, no network, no file access
                    settings.javaScriptEnabled = false
                    settings.blockNetworkLoads = true
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    settings.builtInZoomControls = true
                    settings.displayZoomControls = false
                    settings.useWideViewPort = false
                    settings.loadWithOverviewMode = false
                    settings.textZoom = 130
                    setBackgroundColor(AColor.WHITE)
                } },
                update = { it.loadDataWithBaseURL(null, current, "text/html", "UTF-8", null) },
            )
        }
    }
    LeaveDialog(askLeave, { askLeave = false }, onSave = { askLeave = false; save() }, onDiscard = { askLeave = false; onClose() })
}

@Composable
internal fun TopBar(name: String, dirty: Boolean, onBack: () -> Unit, onSave: () -> Unit, canSave: Boolean) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = onBack) { Text("← Back") }
        Text(name + if (dirty) " •" else "", Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
        FilledTonalButton(onClick = onSave, enabled = canSave) { Text("Save") }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
}

@Composable
internal fun ErrorBox(message: String, onClose: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(message, color = MaterialTheme.colorScheme.error)
        Button(onClick = onClose, modifier = Modifier.padding(top = 12.dp)) { Text("Back") }
    }
}

@Composable
internal fun LeaveDialog(show: Boolean, onCancel: () -> Unit, onSave: () -> Unit, onDiscard: () -> Unit) {
    if (!show) return
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text("Leave without saving?") },
        text = { Text("This file has changes that are not saved.") },
        confirmButton = { TextButton(onClick = onSave) { Text("Save") } },
        dismissButton = { Row { TextButton(onClick = onCancel) { Text("Cancel") }; TextButton(onClick = onDiscard) { Text("Discard") } } },
    )
}
