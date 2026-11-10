package com.apexoffice.android.ui

import android.content.Context
import android.graphics.Color as AColor
import android.net.Uri
import android.text.Editable
import android.text.InputType
import android.text.Layout
import android.text.SpannableStringBuilder
import android.text.TextWatcher
import android.view.Gravity
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.Toast
import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.mutableFloatStateOf
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.apexoffice.android.Formats
import com.apexoffice.android.docs.CharStyle
import com.apexoffice.android.docs.Docx
import com.apexoffice.android.docs.RichText
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.ArrayDeque

private const val DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

/** The rich-text view plus the undo history and the formatting that applies to the next typed text. */
private class Editor(context: Context) : EditText(context) {
    var onSelection: (() -> Unit)? = null
    var onChanged: (() -> Unit)? = null
    val pendingOn = mutableSetOf<CharStyle>()
    val pendingOff = mutableSetOf<CharStyle>()
    private val undo = ArrayDeque<Pair<SpannableStringBuilder, Int>>()
    private val redo = ArrayDeque<Pair<SpannableStringBuilder, Int>>()
    private var restoring = false
    private var lastPush = 0L
    private var lastStart = 0
    private var lastCount = 0
    private var lastBefore = 0
    private var expectedCursor = -1

    init {
        background = null
        gravity = Gravity.TOP or Gravity.START
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        textSize = 16f
        val pad = (16 * resources.displayMetrics.density).toInt()
        setPadding(pad, pad, pad, pad * 4)
        setLineSpacing(0f, 1.15f)
        addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {
                if (!restoring) {
                    val now = System.currentTimeMillis()
                    if (now - lastPush > 800 || count > 1 || after > 1) checkpoint()
                    lastPush = now
                }
            }
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                lastStart = start; lastBefore = before; lastCount = count
            }
            override fun afterTextChanged(e: Editable) {
                if (!restoring) {
                    redo.clear()
                    if (lastCount > lastBefore && (pendingOn.isNotEmpty() || pendingOff.isNotEmpty())) {
                        restoring = true
                        applyPending(lastStart, lastCount)
                        restoring = false
                        expectedCursor = lastStart + lastCount
                    }
                }
                onChanged?.invoke()
            }
        })
    }

    /** Remember the current text so the next edit can be undone. */
    fun checkpoint() {
        undo.addLast(SpannableStringBuilder(text) to selectionStart)
        while (undo.size > 80) undo.removeFirst()
        redo.clear()
    }

    fun undoEdit() = move(undo, redo)
    fun redoEdit() = move(redo, undo)

    private fun move(from: ArrayDeque<Pair<SpannableStringBuilder, Int>>, to: ArrayDeque<Pair<SpannableStringBuilder, Int>>) {
        val snapshot = from.pollLast() ?: return
        to.addLast(SpannableStringBuilder(text) to selectionStart)
        restoring = true
        text.replace(0, text.length, snapshot.first)
        setSelection(snapshot.second.coerceIn(0, text.length))
        restoring = false
    }

    override fun onSelectionChanged(selStart: Int, selEnd: Int) {
        super.onSelectionChanged(selStart, selEnd)
        // typing moves the cursor to where the new text ends: keep the pending format then
        if (selStart != expectedCursor || selEnd != selStart) { pendingOn.clear(); pendingOff.clear() }
        onSelection?.invoke()
    }

    fun clearHistory() { undo.clear(); redo.clear() }

    /** Apply the toggled-but-not-yet-typed formatting to text just inserted. */
    fun applyPending(start: Int, count: Int) {
        if (count <= 0) return
        for (s in pendingOn) if (!RichText.covered(text, start, start + count, s)) RichText.toggle(text, start, start + count, s)
        for (s in pendingOff) RichText.clear(text, start, start + count, s)
    }
}

@Composable
fun DocsScreen(uri: Uri, name: String, onClose: () -> Unit) {
    val context = LocalContext.current
    var editor by remember { mutableStateOf<Editor?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notes by remember { mutableStateOf<List<String>>(emptyList()) }
    var parsed by remember { mutableStateOf<com.apexoffice.android.docs.DocxResult?>(null) }
    var dirty by remember { mutableStateOf(false) }
    var askSave by remember { mutableStateOf(false) }
    var askLeave by remember { mutableStateOf(false) }
    var askColor by remember { mutableStateOf(false) }
    var askFind by remember { mutableStateOf(false) }
    var tick by remember { mutableIntStateOf(0) }
    val ext = Formats.extensionOf(name)
    val stem = name.substringBeforeLast('.')

    LaunchedEffect(uri) {
        if (ext !in setOf("docx", "docm", "dotx", "dotm")) {
            error = "Opening .$ext files in Docs is not available yet. Only Word .docx, .docm, .dotx and .dotm open here for now."
            return@LaunchedEffect
        }
        val result = withContext(Dispatchers.IO) {
            runCatching {
                val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: error("The file could not be read.")
                Docx.read(bytes)
            }
        }
        result.onSuccess { parsed = it }.onFailure { error = it.message ?: "This document could not be opened." }
    }
    // the file and the view arrive independently: put the text in once both are ready
    LaunchedEffect(editor, parsed) {
        val ed = editor
        val p = parsed
        if (ed != null && p != null && !loaded) {
            ed.text.replace(0, ed.text.length, p.text)
            ed.clearHistory()
            notes = p.notes
            dirty = false
            loaded = true
        }
    }

    fun write(target: Uri): Boolean {
        val ed = editor ?: return false
        return try {
            val bytes = Docx.write(ed.text)
            context.contentResolver.openOutputStream(target, "wt")?.use { it.write(bytes) } != null
        } catch (e: Exception) {
            false
        }
    }

    val saveCopy = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(DOCX_MIME)) { target ->
        if (target != null) {
            val ok = write(target)
            Toast.makeText(context, if (ok) "Saved" else "Could not save", Toast.LENGTH_SHORT).show()
            if (ok) dirty = false
        }
    }

    BackHandler { if (dirty) askLeave = true else onClose() }

    var editing by remember { mutableStateOf(false) }
    var showTools by remember { mutableStateOf(false) }
    var toolsTab by remember { mutableStateOf("Home") }
    var zoom by remember { mutableFloatStateOf(1f) }

    fun share() {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = DOCX_MIME; putExtra(Intent.EXTRA_STREAM, uri); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        runCatching { context.startActivity(Intent.createChooser(send, name)) }
    }

    Column(Modifier.fillMaxSize().background(Color(0xFF202124)).statusBarsPadding().navigationBarsPadding().imePadding()) {
        ReaderTopBar(
            title = name + if (dirty) " •" else "",
            subtitle = if (editing) "Editing" else "Read-only",
            onBack = { if (dirty) askLeave = true else onClose() },
            actions = {
                if (editing) {
                    BarAction("↶", "Undo", { editor?.undoEdit() }, enabled = loaded)
                    BarAction("↷", "Redo", { editor?.redoEdit() }, enabled = loaded)
                    BarAction("💾", "Save", { askSave = true }, enabled = loaded)
                }
            },
        )
        if (editing) {
            Box(Modifier.background(MaterialTheme.colorScheme.surface)) {
                Toolbar(editor, tick, onColor = { askColor = true }, onFind = { askFind = true }, enabled = loaded)
            }
        }
        Box(Modifier.weight(1f)) {
            if (error != null) {
                Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface).padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(error!!, color = MaterialTheme.colorScheme.error)
                    Button(onClick = onClose, modifier = Modifier.padding(top = 12.dp)) { Text("Back") }
                }
            } else {
                Box(Modifier.fillMaxSize().background(Color(0xFFE4E7E5)), contentAlignment = Alignment.TopCenter) {
                    AndroidView(
                        modifier = Modifier.widthIn(max = 820.dp).fillMaxSize(),
                        factory = { ctx ->
                            Editor(ctx).also { ed ->
                                ed.setBackgroundColor(AColor.WHITE)
                                ed.setTextColor(AColor.BLACK)
                                ed.onChanged = { dirty = true; tick++ }
                                ed.onSelection = { tick++ }
                                editor = ed
                            }
                        },
                        update = { ed ->
                            // read-only until the user chooses to edit; reading and selecting still work
                            ed.isFocusable = editing
                            ed.isFocusableInTouchMode = editing
                            ed.isCursorVisible = editing
                            ed.showSoftInputOnFocus = editing
                            if (!editing) ed.clearFocus()
                            ed.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 16f * zoom)
                        },
                    )
                }
            }
        }
        ReaderBottomBar(
            if (!editing) listOf(
                BottomItem("✎", "Edit", enabled = loaded) { editing = true },
                BottomItem("⇔", "Fit to Screen", enabled = loaded) { zoom = 1f },
                BottomItem("⌕", "Find and Replace", enabled = loaded) { askFind = true },
                BottomItem("⊞", "Tools") { toolsTab = "Home"; showTools = true },
                BottomItem("⇪", "Share") { share() },
            ) else listOf(
                BottomItem("✓", "Done", selected = true) { editing = false },
                BottomItem("⌕", "Find and Replace", enabled = loaded) { askFind = true },
                BottomItem("⊞", "Tools") { toolsTab = "Home"; showTools = true },
                BottomItem("💾", "Save", enabled = loaded) { askSave = true },
            ),
        )
    }

    if (showTools) {
        ToolsSheet(
            tabs = listOf("Home", "Review", "View"),
            selected = toolsTab,
            onSelect = { toolsTab = it },
            onDismiss = { showTools = false },
        ) { tab ->
            @Suppress("UNUSED_EXPRESSION") tick
            val ed = editor
            val s = ed?.selectionStart?.coerceAtLeast(0) ?: 0
            val e = ed?.selectionEnd?.coerceAtLeast(0) ?: 0
            when (tab) {
                "Home" -> {
                    if (!editing) {
                        ToolGroup("Read-only") {
                            ToolLine("Tap Edit to change this document.", onClick = { editing = true; showTools = false }) {
                                Text("Edit ›", color = Color(0xFF8DD4B1))
                            }
                        }
                    } else {
                        val text = ed?.text
                        val heading = if (text != null) RichText.headingAt(text, s) else 0
                        ToolGroup("Font format") {
                            ToolRow {
                                ToolButton("B", "Bold", active = ed != null && docActive(ed, CharStyle.BOLD)) { docFormat(ed, CharStyle.BOLD) }
                                ToolButton("I", "Italic", active = ed != null && docActive(ed, CharStyle.ITALIC)) { docFormat(ed, CharStyle.ITALIC) }
                                ToolButton("U", "Underline", active = ed != null && docActive(ed, CharStyle.UNDERLINE)) { docFormat(ed, CharStyle.UNDERLINE) }
                                ToolButton("S", "Strike", active = ed != null && docActive(ed, CharStyle.STRIKE)) { docFormat(ed, CharStyle.STRIKE) }
                            }
                            ToolRow {
                                ToolButton("H1", "Heading 1", active = heading == 1) { setHeading(ed, if (heading == 1) 0 else 1) }
                                ToolButton("H2", "Heading 2", active = heading == 2) { setHeading(ed, if (heading == 2) 0 else 2) }
                                ToolButton("H3", "Heading 3", active = heading == 3) { setHeading(ed, if (heading == 3) 0 else 3) }
                                ToolButton("¶", "Normal", active = heading == 0) { setHeading(ed, 0) }
                            }
                            ToolRow {
                                ToolButton("A−", "Smaller") { resize(ed, -1) }
                                ToolButton("A+", "Larger") { resize(ed, +1) }
                                ToolButton("🎨", "Colour") { askColor = true }
                            }
                        }
                        ToolGroup("Paragraph") {
                            val al = if (text != null) RichText.alignmentAt(text, s) else Layout.Alignment.ALIGN_NORMAL
                            ToolRow {
                                ToolButton("•", "Bullets", active = text != null && RichText.isBullet(text, s)) {
                                    ed?.let { x -> x.checkpoint(); RichText.toggleBullet(x.text, minOf(s, e), maxOf(s, e)); x.onChanged?.invoke() }
                                }
                                ToolButton("1.", "Numbering", active = text != null && RichText.isNumbered(text, s)) {
                                    ed?.let { x -> x.checkpoint(); RichText.toggleNumbered(x.text, minOf(s, e), maxOf(s, e)); x.onChanged?.invoke() }
                                }
                            }
                            ToolRow {
                                ToolButton("≡←", "Left", active = al == Layout.Alignment.ALIGN_NORMAL) { align(ed, Layout.Alignment.ALIGN_NORMAL) }
                                ToolButton("≡", "Centre", active = al == Layout.Alignment.ALIGN_CENTER) { align(ed, Layout.Alignment.ALIGN_CENTER) }
                                ToolButton("→≡", "Right", active = al == Layout.Alignment.ALIGN_OPPOSITE) { align(ed, Layout.Alignment.ALIGN_OPPOSITE) }
                            }
                        }
                        ToolGroup("Edit") {
                            ToolRow {
                                ToolButton("↶", "Undo") { ed?.undoEdit() }
                                ToolButton("↷", "Redo") { ed?.redoEdit() }
                            }
                        }
                    }
                }
                "Review" -> {
                    val words = ed?.text?.toString()?.split(Regex("\\s+"))?.count { it.isNotEmpty() } ?: 0
                    ToolGroup("Proofing") {
                        ToolRow {
                            ToolButton("⌕", "Find and Replace", enabled = loaded) { showTools = false; askFind = true }
                        }
                        ToolLine("Words") { Text("$words", color = Color(0xFFE8EAED)) }
                        ToolLine("Characters") { Text("${ed?.text?.length ?: 0}", color = Color(0xFFE8EAED)) }
                    }
                }
                else -> {
                    ToolGroup("Zoom") {
                        ToolRow {
                            ToolButton("−", "Smaller text", enabled = zoom > 0.7f) { zoom = (zoom - 0.15f).coerceAtLeast(0.7f) }
                            ToolButton("⇔", "Fit to Screen") { zoom = 1f }
                            ToolButton("+", "Larger text", enabled = zoom < 2.5f) { zoom = (zoom + 0.15f).coerceAtMost(2.5f) }
                        }
                    }
                }
            }
        }
    }

    if (askSave) {
        val message = buildString {
            if (notes.isNotEmpty()) append("This file contains ${notes.joinToString(", ")} that Apex Office cannot keep yet, so saving over it would remove them. ")
            append("Page setup and custom fonts or styles from the original are simplified. Saving a copy leaves your original untouched.")
        }
        AlertDialog(
            onDismissRequest = { askSave = false },
            title = { Text("Save document") },
            text = { Text(message) },
            confirmButton = { TextButton(onClick = { askSave = false; saveCopy.launch("$stem (Apex).docx") }) { Text("Save a copy") } },
            dismissButton = {
                Row {
                    TextButton(onClick = { askSave = false }) { Text("Cancel") }
                    TextButton(onClick = {
                        askSave = false
                        val ok = write(uri)
                        Toast.makeText(context, if (ok) "Saved" else "Could not overwrite. Save a copy instead.", Toast.LENGTH_SHORT).show()
                        if (ok) dirty = false
                    }) { Text("Overwrite") }
                }
            },
        )
    }

    if (askLeave) {
        AlertDialog(
            onDismissRequest = { askLeave = false },
            title = { Text("Leave without saving?") },
            text = { Text("This document has changes that are not saved.") },
            confirmButton = { TextButton(onClick = { askLeave = false; askSave = true }) { Text("Save") } },
            dismissButton = {
                Row {
                    TextButton(onClick = { askLeave = false }) { Text("Cancel") }
                    TextButton(onClick = { askLeave = false; onClose() }) { Text("Discard") }
                }
            },
        )
    }

    if (askFind) {
        var query by remember { mutableStateOf("") }
        var replacement by remember { mutableStateOf("") }
        var message by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { askFind = false },
            title = { Text("Find and replace") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    androidx.compose.material3.OutlinedTextField(value = query, onValueChange = { query = it; message = "" }, singleLine = true, label = { Text("Find") })
                    androidx.compose.material3.OutlinedTextField(value = replacement, onValueChange = { replacement = it }, singleLine = true, label = { Text("Replace with") })
                    if (message.isNotEmpty()) Text(message, color = MaterialTheme.colorScheme.secondary)
                }
            },
            confirmButton = {
                Row {
                    TextButton(enabled = query.isNotEmpty(), onClick = {
                        val ed = editor ?: return@TextButton
                        val all = ed.text.toString()
                        var at = all.indexOf(query, ed.selectionEnd.coerceAtLeast(0), ignoreCase = true)
                        if (at < 0) at = all.indexOf(query, 0, ignoreCase = true)
                        if (at >= 0) { ed.requestFocus(); ed.setSelection(at, at + query.length); message = "" } else message = "Not found"
                    }) { Text("Find next") }
                    TextButton(enabled = query.isNotEmpty(), onClick = {
                        val ed = editor ?: return@TextButton
                        val all = ed.text.toString()
                        val hits = ArrayList<Int>()
                        var at = all.indexOf(query, 0, ignoreCase = true)
                        while (at >= 0) { hits.add(at); at = all.indexOf(query, at + query.length, ignoreCase = true) }
                        if (hits.isNotEmpty()) {
                            ed.checkpoint()
                            for (h in hits.asReversed()) ed.text.replace(h, h + query.length, replacement)
                        }
                        message = if (hits.isEmpty()) "Not found" else "Replaced ${hits.size}"
                    }) { Text("Replace all") }
                }
            },
            dismissButton = { TextButton(onClick = { askFind = false }) { Text("Close") } },
        )
    }

    if (askColor) {
        val palette = listOf(0xFF000000, 0xFFC53030, 0xFFD9622B, 0xFFB7791F, 0xFF1E8E5A, 0xFF2B6CB0, 0xFF5A67D8, 0xFF8E44AD, 0xFF718096)
        AlertDialog(
            onDismissRequest = { askColor = false },
            title = { Text("Text colour") },
            text = {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    for (c in palette) Box(Modifier.size(38.dp).background(Color(c), RoundedCornerShape(19.dp)).clickable {
                        editor?.let { ed ->
                            ed.checkpoint()
                            RichText.setColor(ed.text, ed.selectionStart.coerceAtLeast(0), ed.selectionEnd.coerceAtLeast(0), if (c == 0xFF000000) null else c.toInt())
                        }
                        askColor = false
                    })
                }
            },
            confirmButton = { TextButton(onClick = { askColor = false }) { Text("Close") } },
        )
    }
}

@Composable
private fun Toolbar(editor: Editor?, tick: Int, onColor: () -> Unit, onFind: () -> Unit, enabled: Boolean) {
    @Suppress("UNUSED_EXPRESSION") tick
    val ed = editor
    val text = ed?.text
    val s = ed?.selectionStart?.coerceAtLeast(0) ?: 0
    val e = ed?.selectionEnd?.coerceAtLeast(0) ?: 0
    fun active(style: CharStyle): Boolean {
        if (text == null) return false
        if (style in (ed?.pendingOn ?: emptySet())) return true
        if (style in (ed?.pendingOff ?: emptySet())) return false
        return RichText.covered(text, minOf(s, e), maxOf(s, e), style)
    }
    fun format(style: CharStyle) {
        val x = ed ?: return
        if (maxOf(s, e) > minOf(s, e)) {
            x.checkpoint()
            RichText.toggle(x.text, minOf(s, e), maxOf(s, e), style)
        } else if (active(style)) {
            x.pendingOn.remove(style); x.pendingOff.add(style)
        } else {
            x.pendingOff.remove(style); x.pendingOn.add(style)
        }
        x.onChanged?.invoke()
    }

    val heading = if (text != null) RichText.headingAt(text, s) else 0
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ToolButton("↶", false, enabled) { ed?.undoEdit() }
        ToolButton("↷", false, enabled) { ed?.redoEdit() }
        ToolButton("Find", false, enabled) { onFind() }
        ToolButton("B", active(CharStyle.BOLD), enabled, FontWeight.Bold) { format(CharStyle.BOLD) }
        ToolButton("I", active(CharStyle.ITALIC), enabled, italic = true) { format(CharStyle.ITALIC) }
        ToolButton("U", active(CharStyle.UNDERLINE), enabled, underline = true) { format(CharStyle.UNDERLINE) }
        ToolButton("S", active(CharStyle.STRIKE), enabled, strike = true) { format(CharStyle.STRIKE) }
        ToolButton("A−", false, enabled) { resize(ed, -1) }
        ToolButton("A+", false, enabled) { resize(ed, +1) }
        ToolButton("🎨", false, enabled) { onColor() }
        ToolButton("H1", heading == 1, enabled) { setHeading(ed, if (heading == 1) 0 else 1) }
        ToolButton("H2", heading == 2, enabled) { setHeading(ed, if (heading == 2) 0 else 2) }
        ToolButton("H3", heading == 3, enabled) { setHeading(ed, if (heading == 3) 0 else 3) }
        ToolButton("•", text != null && RichText.isBullet(text, s), enabled) {
            ed?.let { x -> x.checkpoint(); RichText.toggleBullet(x.text, minOf(s, e), maxOf(s, e)); x.onChanged?.invoke() }
        }
        ToolButton("1.", text != null && RichText.isNumbered(text, s), enabled) {
            ed?.let { x -> x.checkpoint(); RichText.toggleNumbered(x.text, minOf(s, e), maxOf(s, e)); x.onChanged?.invoke() }
        }
        val al = if (text != null) RichText.alignmentAt(text, s) else Layout.Alignment.ALIGN_NORMAL
        ToolButton("≡←", al == Layout.Alignment.ALIGN_NORMAL, enabled) { align(ed, Layout.Alignment.ALIGN_NORMAL) }
        ToolButton("≡", al == Layout.Alignment.ALIGN_CENTER, enabled) { align(ed, Layout.Alignment.ALIGN_CENTER) }
        ToolButton("→≡", al == Layout.Alignment.ALIGN_OPPOSITE, enabled) { align(ed, Layout.Alignment.ALIGN_OPPOSITE) }
    }
}

private fun resize(ed: Editor?, delta: Int) {
    val x = ed ?: return
    val a = minOf(x.selectionStart, x.selectionEnd).coerceAtLeast(0)
    val b = maxOf(x.selectionStart, x.selectionEnd).coerceAtLeast(0)
    if (b <= a) return
    x.checkpoint()
    RichText.setSize(x.text, a, b, (RichText.sizeAt(x.text, b) + delta * 2).coerceIn(8, 96))
    x.onChanged?.invoke()
}

private fun setHeading(ed: Editor?, level: Int) {
    val x = ed ?: return
    x.checkpoint()
    RichText.setHeading(x.text, x.selectionStart.coerceAtLeast(0), x.selectionEnd.coerceAtLeast(0), level)
    x.onChanged?.invoke()
}

private fun align(ed: Editor?, alignment: Layout.Alignment) {
    val x = ed ?: return
    x.checkpoint()
    RichText.setAlignment(x.text, x.selectionStart.coerceAtLeast(0), x.selectionEnd.coerceAtLeast(0), alignment)
    x.onChanged?.invoke()
}

@Composable
private fun ToolButton(
    label: String,
    selected: Boolean,
    enabled: Boolean,
    weight: FontWeight = FontWeight.Medium,
    italic: Boolean = false,
    underline: Boolean = false,
    strike: Boolean = false,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .height(40.dp)
            .widthIn(min = 40.dp)
            .background(if (selected) MaterialTheme.colorScheme.primaryContainer else Color.Transparent, RoundedCornerShape(10.dp))
            .border(1.dp, MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(10.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            fontWeight = weight,
            fontStyle = if (italic) FontStyle.Italic else FontStyle.Normal,
            textDecoration = when {
                underline -> TextDecoration.Underline
                strike -> TextDecoration.LineThrough
                else -> null
            },
            color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.outline,
        )
    }
}

private fun docActive(ed: Editor, style: CharStyle): Boolean {
    val s = ed.selectionStart.coerceAtLeast(0)
    val e = ed.selectionEnd.coerceAtLeast(0)
    if (style in ed.pendingOn) return true
    if (style in ed.pendingOff) return false
    return RichText.covered(ed.text, minOf(s, e), maxOf(s, e), style)
}

private fun docFormat(ed: Editor?, style: CharStyle) {
    val x = ed ?: return
    val s = x.selectionStart.coerceAtLeast(0)
    val e = x.selectionEnd.coerceAtLeast(0)
    if (maxOf(s, e) > minOf(s, e)) {
        x.checkpoint()
        RichText.toggle(x.text, minOf(s, e), maxOf(s, e), style)
    } else if (docActive(x, style)) {
        x.pendingOn.remove(style); x.pendingOff.add(style)
    } else {
        x.pendingOff.remove(style); x.pendingOn.add(style)
    }
    x.onChanged?.invoke()
}
