package com.apexoffice.android.ui

import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateDecay
import androidx.compose.animation.core.FloatExponentialDecaySpec
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.draggable2D
import androidx.compose.foundation.gestures.rememberDraggable2DState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.input.ImeAction
import com.apexoffice.android.sheets.Cell
import com.apexoffice.android.sheets.SheetsSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

private fun colLabel(col: Int): String {
    var n = col
    val sb = StringBuilder()
    while (n > 0) {
        sb.insert(0, 'A' + (n - 1) % 26)
        n = (n - 1) / 26
    }
    return sb.toString()
}

@Composable
fun SheetsScreen(uri: Uri, name: String, onClose: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var session by remember { mutableStateOf<SheetsSession?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }

    LaunchedEffect(uri) {
        val (s, e) = withContext(Dispatchers.IO) { SheetsSession.open(context.contentResolver, uri, name) }
        session = s
        error = e
        loading = false
    }
    val opened = session
    androidx.compose.runtime.DisposableEffect(opened) { onDispose { opened?.close() } }

    var dirty by remember { mutableStateOf(false) }
    var askDiscard by remember { mutableStateOf(false) }

    fun writeTo(target: Uri): Boolean {
        val bytes = session?.toXlsx() ?: return false
        return try {
            context.contentResolver.openOutputStream(target, "wt")?.use { it.write(bytes) } != null
        } catch (e: Exception) {
            false
        }
    }

    val saveAs = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(XLSX_MIME)) { target ->
        if (target != null) {
            val ok = writeTo(target)
            Toast.makeText(context, if (ok) "Saved" else "Could not save", Toast.LENGTH_SHORT).show()
            if (ok) dirty = false
        }
    }

    fun save() {
        val s = session ?: return
        if (s.needsSaveAs) saveAs.launch(s.displayName)
        else {
            val ok = writeTo(uri)
            Toast.makeText(context, if (ok) "Saved" else "Could not save. Use Save as.", Toast.LENGTH_SHORT).show()
            if (ok) dirty = false else saveAs.launch(s.displayName)
        }
    }

    BackHandler { if (dirty) askDiscard = true else onClose() }

    val wideScreen = LocalWide.current
    var editingMode by remember { mutableStateOf(wideScreen) }
    var showTools by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface).statusBarsPadding().navigationBarsPadding().imePadding()) {
        ReaderTopBar(
            title = (session?.displayName ?: name) + if (dirty) " •" else "",
            subtitle = if (editingMode) "Editing" else "Read-only",
            onBack = { if (dirty) askDiscard = true else onClose() },
            actions = { if (editingMode) BarAction("💾", "Save", { save() }, enabled = session != null) },
        )
        Box(Modifier.weight(1f)) {        when {
            loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Opening…") }
            session == null -> Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(error ?: "This file could not be opened.", color = MaterialTheme.colorScheme.error)
                    Button(onClick = onClose) { Text("Back") }
                }
            }
            else -> SheetBody(session!!, canEdit = editingMode, showTools = showTools, onToolsClose = { showTools = false }, onStartEdit = { editingMode = true }, onEdited = { dirty = true })
        }
        }
        ReaderBottomBar(
            if (!editingMode) listOf(
                BottomItem("✎", "Edit", enabled = session != null) { editingMode = true },
                BottomItem("⊞", "Tools") { showTools = true },
                BottomItem("⇪", "Share") {
                    val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                        type = XLSX_MIME; putExtra(android.content.Intent.EXTRA_STREAM, uri); addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    runCatching { context.startActivity(android.content.Intent.createChooser(send, name)) }
                },
            ) else listOf(
                BottomItem("✓", "Done", selected = true) { editingMode = false },
                BottomItem("⊞", "Tools") { showTools = true },
                BottomItem("💾", "Save", enabled = session != null) { save() },
            ),
        )    }

    if (askDiscard) {
        AlertDialog(
            onDismissRequest = { askDiscard = false },
            title = { Text("Save changes?") },
            text = { Text("This workbook has changes that are not saved.") },
            confirmButton = { TextButton(onClick = { askDiscard = false; save() }) { Text("Save") } },
            dismissButton = {
                Row {
                    TextButton(onClick = { askDiscard = false }) { Text("Cancel") }
                    TextButton(onClick = { askDiscard = false; onClose() }) { Text("Discard") }
                }
            },
        )
    }
}

@Composable
private fun SheetBody(session: SheetsSession, canEdit: Boolean, showTools: Boolean, onToolsClose: () -> Unit, onStartEdit: () -> Unit, onEdited: () -> Unit) {
    var sheet by remember { mutableIntStateOf(0) }
    var selRow by remember { mutableIntStateOf(1) }
    var selCol by remember { mutableIntStateOf(1) }
    var tabs by remember { mutableStateOf(session.sheetNames) }
    val cache: SnapshotStateMap<Long, Cell> = remember(session, sheet) { mutableStateMapOf() }
    var formula by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf(false) }
    var colorTarget by remember { mutableIntStateOf(0) }
    var endRow by remember { mutableIntStateOf(1) }
    var endCol by remember { mutableIntStateOf(1) }
    var rangeMode by remember { mutableStateOf(false) }
    var askFormat by remember { mutableStateOf(false) }
    val clipboard = androidx.compose.ui.platform.LocalContext.current.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
    var version by remember(session) { mutableIntStateOf(0) }
    val focus = androidx.compose.ui.platform.LocalFocusManager.current

    LaunchedEffect(session, sheet, selRow, selCol, version) {
        if (!editing) formula = withContext(Dispatchers.Default) { session.input(sheet, selRow, selCol) }
    }

    fun commit() {
        if (!editing) return
        editing = false
        if (session.setInput(sheet, selRow, selCol, formula)) {
            version++
            onEdited()
        }
        focus.clearFocus()
    }

    val r0 = minOf(selRow, endRow)
    val r1 = maxOf(selRow, endRow)
    val c0 = minOf(selCol, endCol)
    val c1 = maxOf(selCol, endCol)
    fun changed() { version++; onEdited() }
    fun act(op: Int, index: Int) {
        commit()
        if (session.edit(sheet, op, index)) changed()
    }
    fun forRange(f: (Int, Int) -> Unit) { for (r in r0..r1) for (c in c0..c1) f(r, c) }
    fun styleRange(prop: Int, value: Int = 0) {
        commit()
        session.snapshot()
        var any = false
        forRange { r, c -> if (session.style(sheet, r, c, prop, value, snapshot = false)) any = true }
        if (any) changed()
    }
    fun clearRange() {
        commit()
        session.snapshot()
        forRange { r, c -> session.setInput(sheet, r, c, "", snapshot = false) }
        formula = ""
        changed()
    }
    fun copy(cut: Boolean) {
        commit()
        val text = (r0..r1).joinToString("\n") { r -> (c0..c1).joinToString("\t") { c -> session.input(sheet, r, c) } }
        clipboard.setPrimaryClip(android.content.ClipData.newPlainText("cells", text))
        if (cut) clearRange()
    }
    fun paste() {
        commit()
        val text = clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.text?.toString() ?: return
        session.snapshot()
        text.replace("\r\n", "\n").trimEnd('\n').split('\n').forEachIndexed { ri, line ->
            line.split('\t').forEachIndexed { ci, v -> session.setInput(sheet, r0 + ri, c0 + ci, v, snapshot = false) }
        }
        changed()
    }

    val wide = LocalWide.current
    var toolsTab by remember { mutableStateOf("Home") }
    val sheetTools: @Composable (String) -> Unit = { tab ->
                if (!canEdit) {
                    ToolGroup("Read-only") {
                        ToolLine("Tap Edit to change this workbook.", onClick = { onStartEdit(); onToolsClose() }) {
                            Text("Edit ›", color = Color(0xFF8DD4B1))
                        }
                    }
                } else if (tab == "Home") {
                    ToolGroup("Edit") {
                        ToolRow {
                            ToolButton("↶", "Undo") { commit(); if (session.undo()) changed() }
                            ToolButton("↷", "Redo") { commit(); if (session.redo()) changed() }
                            ToolButton("▭", "Select range", active = rangeMode) { rangeMode = !rangeMode; if (!rangeMode) { endRow = selRow; endCol = selCol } }
                        }
                        ToolRow {
                            ToolButton("⧉", "Copy") { copy(false) }
                            ToolButton("✂", "Cut") { copy(true) }
                            ToolButton("📋", "Paste") { paste() }
                            ToolButton("⌫", "Clear") { clearRange() }
                        }
                    }
                    ToolGroup("Font and fill") {
                        ToolRow {
                            ToolButton("B", "Bold") { styleRange(0) }
                            ToolButton("I", "Italic") { styleRange(1) }
                            ToolButton("▣", "Fill") { onToolsClose(); colorTarget = 2 }
                            ToolButton("A", "Text colour") { onToolsClose(); colorTarget = 3 }
                        }
                    }
                    ToolGroup("Alignment and number") {
                        ToolRow {
                            ToolButton("≡←", "Left") { styleRange(4, 1) }
                            ToolButton("≡", "Centre") { styleRange(4, 2) }
                            ToolButton("→≡", "Right") { styleRange(4, 3) }
                            ToolButton("123", "Number format") { onToolsClose(); askFormat = true }
                        }
                    }
                } else {
                    ToolGroup("Rows and columns") {
                        ToolRow {
                            ToolButton("＋", "Insert row") { act(0, selRow) }
                            ToolButton("－", "Delete row") { act(1, selRow) }
                            ToolButton("⫼", "Insert column") { act(2, selCol) }
                            ToolButton("⫽", "Delete column") { act(3, selCol) }
                        }
                        ToolRow {
                            ToolButton("↔", "Wider column") { if (session.resizeColumn(sheet, selCol, 1.25)) changed() }
                            ToolButton("⇹", "Narrower column") { if (session.resizeColumn(sheet, selCol, 0.8)) changed() }
                        }
                    }
                }
    }

    Row(Modifier.fillMaxSize()) {
    Column(Modifier.weight(1f).fillMaxHeight()) {
        if (showTools && !wide) ToolsSheet(tabs = listOf("Home", "Cells"), selected = toolsTab, onSelect = { toolsTab = it }, onDismiss = onToolsClose) { tab -> sheetTools(tab) }
        // formula bar
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(
                Modifier.width(64.dp).height(38.dp).border(1.dp, MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(8.dp)),
                contentAlignment = Alignment.Center,
            ) { Text(colLabel(selCol) + selRow, style = MaterialTheme.typography.labelLarge) }
            Text("fx", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
            BasicTextField(
                value = formula,
                onValueChange = { formula = it; editing = true },
                singleLine = true,
                enabled = canEdit,
                textStyle = TextStyle(color = MaterialTheme.colorScheme.onSurface, fontSize = 15.sp),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { commit() }),
                modifier = Modifier
                    .weight(1f)
                    .height(38.dp)
                    .border(1.dp, MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(8.dp))
                    .padding(horizontal = 10.dp, vertical = 9.dp),
            )
            if (canEdit) TextButton(onClick = { commit() }, enabled = editing) { Text("✓") }
        }
        if (colorTarget != 0) {
            val palette = listOf(-1, 0xFFE699, 0xC6EFCE, 0xBDD7EE, 0xF8CBAD, 0xD9D2E9, 0xFFFF00, 0xC53030, 0x1E8E5A, 0x2B6CB0, 0x000000)
            androidx.compose.material3.AlertDialog(
                onDismissRequest = { colorTarget = 0 },
                title = { Text(if (colorTarget == 2) "Fill colour" else "Text colour") },
                text = {
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        for (c in palette) Box(
                            Modifier.size(40.dp)
                                .background(if (c < 0) Color.White else Color(0xFF000000.toInt() or c), RoundedCornerShape(20.dp))
                                .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(20.dp))
                                .clickable { styleRange(colorTarget, c); colorTarget = 0 },
                            contentAlignment = Alignment.Center,
                        ) { if (c < 0) Text("✕") }
                    }
                },
                confirmButton = { TextButton(onClick = { colorTarget = 0 }) { Text("Close") } },
            )
        }
        if (askFormat) {
            val formats = listOf("General", "Number  1,234.50", "Percent  12%", "Currency  \$1,234.50", "Date  2026-11-08", "Two decimals  1.50")
            androidx.compose.material3.AlertDialog(
                onDismissRequest = { askFormat = false },
                title = { Text("Number format") },
                text = {
                    Column {
                        formats.forEachIndexed { index, label ->
                            Text(label, Modifier.fillMaxWidth().clickable { styleRange(5, index); askFormat = false }.padding(vertical = 12.dp))
                        }
                    }
                },
                confirmButton = { TextButton(onClick = { askFormat = false }) { Text("Close") } },
            )
        }
        Grid(
            session = session,
            sheet = sheet,
            cache = cache,
            version = version,
            selRow = selRow,
            selCol = selCol,
            endRow = endRow,
            endCol = endCol,
            onSelect = { r, c ->
                commit()
                if (rangeMode) { endRow = r; endCol = c } else { selRow = r; selCol = c; endRow = r; endCol = c }
            },
            modifier = Modifier.weight(1f),
        )
        HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
        LazyRow(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            itemsIndexed(tabs) { index, title ->
                val selected = index == sheet
                Text(
                    title,
                    modifier = Modifier
                        .background(
                            if (selected) MaterialTheme.colorScheme.primaryContainer else Color.Transparent,
                            RoundedCornerShape(10.dp),
                        )
                        .clickable { commit(); sheet = index; selRow = 1; selCol = 1; endRow = 1; endCol = 1; rangeMode = false }
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                )
            }
            if (canEdit) item {
                TextButton(onClick = { if (session.addSheet()) { tabs = session.sheetNames; sheet = tabs.size - 1; onEdited() } }) { Text("+") }
            }
        }
    }
    if (wide) ToolsPanel(listOf("Home", "Cells"), toolsTab, { toolsTab = it }) { sheetTools(it) }
    }
}

@Composable
private fun Grid(
    session: SheetsSession,
    sheet: Int,
    cache: SnapshotStateMap<Long, Cell>,
    version: Int,
    selRow: Int,
    selCol: Int,
    endRow: Int,
    endCol: Int,
    onSelect: (Int, Int) -> Unit,
    modifier: Modifier,
) {
    val density = LocalDensity.current
    val measurer = rememberTextMeasurer()
    val scope = rememberCoroutineScope()
    val outline = MaterialTheme.colorScheme.surfaceVariant
    val headerFill = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.55f)
    val primary = MaterialTheme.colorScheme.primary
    val onSurface = MaterialTheme.colorScheme.onSurface
    val surface = MaterialTheme.colorScheme.surface

    val used = remember(session, sheet, version) { session.used(sheet) }
    val rowCount = maxOf(used.first + 50, 120)
    val colCount = maxOf(used.second + 20, 30)
    val rowHeightPx = with(density) { session.rowHeightDp(sheet, 1).dp.toPx() }
    val colWidthsPx = remember(session, sheet, colCount, version) {
        FloatArray(colCount) { with(density) { session.columnWidthDp(sheet, it + 1).dp.toPx() } }
    }
    val colStartPx = remember(colWidthsPx) {
        FloatArray(colCount + 1).also { for (i in 0 until colCount) it[i + 1] = it[i] + colWidthsPx[i] }
    }
    val headerW = with(density) { 46.dp.toPx() }
    val headerH = with(density) { 30.dp.toPx() }
    val textSize = 14.sp

    var offX by remember(sheet) { mutableFloatStateOf(0f) }
    var offY by remember(sheet) { mutableFloatStateOf(0f) }
    var viewW by remember { mutableFloatStateOf(0f) }
    var viewH by remember { mutableFloatStateOf(0f) }

    fun clampX(v: Float) = v.coerceIn(0f, maxOf(0f, colStartPx[colCount] - (viewW - headerW)))
    fun clampY(v: Float) = v.coerceIn(0f, maxOf(0f, rowCount * rowHeightPx - (viewH - headerH)))

    fun colAt(x: Float): Int {
        var lo = 0
        var hi = colCount - 1
        while (lo < hi) {
            val mid = (lo + hi + 1) / 2
            if (colStartPx[mid] <= x) lo = mid else hi = mid - 1
        }
        return lo
    }

    val firstRow by remember { derivedStateOf { (offY / rowHeightPx).toInt() } }
    val lastRow by remember { derivedStateOf { minOf(rowCount - 1, ((offY + viewH) / rowHeightPx).toInt()) } }
    val firstCol by remember { derivedStateOf { colAt(offX) } }
    val lastCol by remember { derivedStateOf { colAt(offX + viewW) } }

    // load the visible window (plus a margin) in 32x8 aligned blocks
    var loadedVersion by remember(session, sheet) { mutableIntStateOf(0) }
    LaunchedEffect(session, sheet, version, firstRow / 32, lastRow / 32, firstCol / 8, lastCol / 8) {
        val r0 = (firstRow / 32) * 32 + 1
        val r1 = ((lastRow / 32) + 1) * 32 + 32
        val c0 = (firstCol / 8) * 8 + 1
        val c1 = ((lastCol / 8) + 1) * 8 + 8
        val block = withContext(Dispatchers.Default) { session.readBlock(sheet, r0, c0, r1, c1) }
        if (loadedVersion != version) {
            cache.clear()
            loadedVersion = version
        }
        cache.putAll(block)
    }

    BoxWithConstraints(modifier.fillMaxSize().clipToBounds().background(surface)) {
        viewW = with(density) { maxWidth.toPx() }
        viewH = with(density) { maxHeight.toPx() }
        val dragState = rememberDraggable2DState { delta ->
            offX = clampX(offX - delta.x)
            offY = clampY(offY - delta.y)
        }
        Box(
            Modifier
                .fillMaxSize()
                .draggable2D(
                    state = dragState,
                    onDragStopped = { velocity ->
                        scope.launch { animateDecay(offX, -velocity.x, FloatExponentialDecaySpec()) { v, _ -> offX = clampX(v) } }
                        scope.launch { animateDecay(offY, -velocity.y, FloatExponentialDecaySpec()) { v, _ -> offY = clampY(v) } }
                    },
                )
                .pointerInput(sheet, colStartPx, rowHeightPx) {
                    detectTapGestures { pos ->
                        if (pos.x > headerW && pos.y > headerH) {
                            val c = colAt(pos.x - headerW + offX)
                            val r = ((pos.y - headerH + offY) / rowHeightPx).toInt()
                            if (r in 0 until rowCount) onSelect(r + 1, c + 1)
                        }
                    }
                }
                .drawBehind {
                    // keep reads of the cache and selection inside draw so edits repaint
                    val sr = selRow
                    val sc = selCol
                    cache.size
                    val gridLeft = headerW
                    val gridTop = headerH
                    clipRect(gridLeft, gridTop, size.width, size.height) {
                        for (r in firstRow..lastRow) {
                            val y = gridTop + r * rowHeightPx - offY
                            for (c in firstCol..minOf(lastCol, colCount - 1)) {
                                val x = gridLeft + colStartPx[c] - offX
                                val w = colWidthsPx[c]
                                val cell = cache[SheetsSession.key(r + 1, c + 1)]
                                if (cell?.fill != null) drawRect(Color(cell.fill), Offset(x, y), Size(w, rowHeightPx))
                                if (cell != null && cell.text.isNotEmpty()) {
                                    val numeric = cell.text.firstOrNull()?.let { it.isDigit() || it == '-' || it == '$' } == true &&
                                        cell.text.all { it.isDigit() || it in "-.,%$ eE+" }
                                    val result = measurer.measure(
                                        cell.text,
                                        TextStyle(
                                            color = cell.color?.let { Color(it) } ?: onSurface,
                                            fontSize = textSize,
                                            fontWeight = if (cell.bold) FontWeight.Bold else FontWeight.Normal,
                                            fontStyle = if (cell.italic) FontStyle.Italic else FontStyle.Normal,
                                            textDecoration = if (cell.underline) TextDecoration.Underline else null,
                                        ),
                                        overflow = TextOverflow.Clip,
                                        softWrap = false,
                                        maxLines = 1,
                                        constraints = Constraints(maxWidth = (w - 12f).toInt().coerceAtLeast(1)),
                                    )
                                    val rightAlign = cell.align == 'R' || (cell.align == ' ' && numeric)
                                    val tx = when {
                                        cell.align == 'C' -> x + (w - result.size.width) / 2f
                                        rightAlign -> x + w - 6f - result.size.width
                                        else -> x + 6f
                                    }
                                    drawText(result, topLeft = Offset(tx, y + (rowHeightPx - result.size.height) / 2f))
                                }
                                drawRect(outline, Offset(x + w - 1f, y), Size(1f, rowHeightPx))
                            }
                            drawRect(outline, Offset(gridLeft, y + rowHeightPx - 1f), Size(size.width, 1f))
                        }
                        // selection
                        val rc0 = (minOf(sc, endCol) - 1).coerceIn(0, colCount - 1)
                        val rc1 = (maxOf(sc, endCol) - 1).coerceIn(0, colCount - 1)
                        val rr0 = minOf(sr, endRow) - 1
                        val rr1 = maxOf(sr, endRow) - 1
                        val sx = gridLeft + colStartPx[rc0] - offX
                        val sy = gridTop + rr0 * rowHeightPx - offY
                        val sw = colStartPx[rc1 + 1] - colStartPx[rc0]
                        val sh = (rr1 - rr0 + 1) * rowHeightPx
                        if (rc1 > rc0 || rr1 > rr0) drawRect(primary.copy(alpha = 0.14f), Offset(sx, sy), Size(sw, sh))
                        drawRect(primary, Offset(sx, sy), Size(sw, sh), style = androidx.compose.ui.graphics.drawscope.Stroke(width = 3f))
                    }
                    // column headers
                    clipRect(gridLeft, 0f, size.width, gridTop) {
                        drawRect(headerFill, Offset(gridLeft, 0f), Size(size.width, gridTop))
                        for (c in firstCol..minOf(lastCol, colCount - 1)) {
                            val x = gridLeft + colStartPx[c] - offX
                            val w = colWidthsPx[c]
                            if (c + 1 == sc) drawRect(primary.copy(alpha = 0.18f), Offset(x, 0f), Size(w, gridTop))
                            val r = measurer.measure(colLabel(c + 1), TextStyle(color = onSurface, fontSize = 12.sp, fontWeight = FontWeight.Medium))
                            drawText(r, topLeft = Offset(x + (w - r.size.width) / 2f, (gridTop - r.size.height) / 2f))
                            drawRect(outline, Offset(x + w - 1f, 0f), Size(1f, gridTop))
                        }
                    }
                    // row headers
                    clipRect(0f, gridTop, gridLeft, size.height) {
                        drawRect(headerFill, Offset(0f, gridTop), Size(gridLeft, size.height))
                        for (r in firstRow..lastRow) {
                            val y = gridTop + r * rowHeightPx - offY
                            if (r + 1 == sr) drawRect(primary.copy(alpha = 0.18f), Offset(0f, y), Size(gridLeft, rowHeightPx))
                            val t = measurer.measure((r + 1).toString(), TextStyle(color = onSurface, fontSize = 12.sp))
                            drawText(t, topLeft = Offset((gridLeft - t.size.width) / 2f, y + (rowHeightPx - t.size.height) / 2f))
                            drawRect(outline, Offset(0f, y + rowHeightPx - 1f), Size(gridLeft, 1f))
                        }
                    }
                    drawRect(headerFill, Offset.Zero, Size(gridLeft, gridTop))
                    drawRect(outline, Offset(gridLeft - 1f, 0f), Size(1f, size.height))
                    drawRect(outline, Offset(0f, gridTop - 1f), Size(size.width, 1f))
                },
        )
    }
}

@Composable
private fun Chip(
    label: String,
    selected: Boolean = false,
    bold: Boolean = false,
    italic: Boolean = false,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .height(36.dp)
            .background(if (selected) MaterialTheme.colorScheme.primaryContainer else Color.Transparent, RoundedCornerShape(18.dp))
            .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.6f), RoundedCornerShape(18.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = if (bold) FontWeight.Bold else FontWeight.Medium,
            fontStyle = if (italic) androidx.compose.ui.text.font.FontStyle.Italic else androidx.compose.ui.text.font.FontStyle.Normal,
        )
    }
}
