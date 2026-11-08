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

    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = { if (dirty) askDiscard = true else onClose() }) { Text("← Back") }
            Text(
                (session?.displayName ?: name) + if (dirty) " •" else "",
                modifier = Modifier.weight(1f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.titleMedium,
            )
            FilledTonalButton(onClick = { save() }, enabled = session != null) { Text("Save") }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
        when {
            loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Opening…") }
            session == null -> Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(error ?: "This file could not be opened.", color = MaterialTheme.colorScheme.error)
                    Button(onClick = onClose) { Text("Back") }
                }
            }
            else -> SheetBody(session!!, onEdited = { dirty = true })
        }
    }

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
private fun SheetBody(session: SheetsSession, onEdited: () -> Unit) {
    var sheet by remember { mutableIntStateOf(0) }
    var selRow by remember { mutableIntStateOf(1) }
    var selCol by remember { mutableIntStateOf(1) }
    var tabs by remember { mutableStateOf(session.sheetNames) }
    val cache: SnapshotStateMap<Long, Cell> = remember(session, sheet) { mutableStateMapOf() }
    var formula by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf(false) }
    var colorTarget by remember { mutableIntStateOf(0) }
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

    Column(Modifier.fillMaxSize()) {
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
                textStyle = TextStyle(color = MaterialTheme.colorScheme.onSurface, fontSize = 15.sp),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { commit() }),
                modifier = Modifier
                    .weight(1f)
                    .height(38.dp)
                    .border(1.dp, MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(8.dp))
                    .padding(horizontal = 10.dp, vertical = 9.dp),
            )
            TextButton(onClick = { commit() }, enabled = editing) { Text("✓") }
        }
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            fun act(op: Int, index: Int) {
                commit()
                if (session.edit(sheet, op, index)) { version++; onEdited() }
            }
            androidx.compose.material3.OutlinedButton(onClick = { act(0, selRow) }) { Text("+ Row") }
            androidx.compose.material3.OutlinedButton(onClick = { act(1, selRow) }) { Text("− Row") }
            androidx.compose.material3.OutlinedButton(onClick = { act(2, selCol) }) { Text("+ Col") }
            androidx.compose.material3.OutlinedButton(onClick = { act(3, selCol) }) { Text("− Col") }
            androidx.compose.material3.OutlinedButton(onClick = {
                if (session.setInput(sheet, selRow, selCol, "")) { version++; onEdited(); formula = "" }
            }) { Text("Clear cell") }
        }
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            fun changed() { version++; onEdited() }
            androidx.compose.material3.OutlinedButton(onClick = { commit(); if (session.undo()) changed() }) { Text("Undo") }
            androidx.compose.material3.OutlinedButton(onClick = { commit(); if (session.redo()) changed() }) { Text("Redo") }
            androidx.compose.material3.OutlinedButton(onClick = { if (session.style(sheet, selRow, selCol, 0)) changed() }) { Text("B", fontWeight = FontWeight.Bold) }
            androidx.compose.material3.OutlinedButton(onClick = { if (session.style(sheet, selRow, selCol, 1)) changed() }) { Text("I", fontStyle = androidx.compose.ui.text.font.FontStyle.Italic) }
            androidx.compose.material3.OutlinedButton(onClick = { colorTarget = 2 }) { Text("Fill") }
            androidx.compose.material3.OutlinedButton(onClick = { colorTarget = 3 }) { Text("Text colour") }
            androidx.compose.material3.OutlinedButton(onClick = { if (session.style(sheet, selRow, selCol, 4, 1)) changed() }) { Text("Left") }
            androidx.compose.material3.OutlinedButton(onClick = { if (session.style(sheet, selRow, selCol, 4, 2)) changed() }) { Text("Centre") }
            androidx.compose.material3.OutlinedButton(onClick = { if (session.style(sheet, selRow, selCol, 4, 3)) changed() }) { Text("Right") }
            androidx.compose.material3.OutlinedButton(onClick = { if (session.resizeColumn(sheet, selCol, 1.25)) changed() }) { Text("Wider") }
            androidx.compose.material3.OutlinedButton(onClick = { if (session.resizeColumn(sheet, selCol, 0.8)) changed() }) { Text("Narrower") }
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
                                .clickable {
                                    if (session.style(sheet, selRow, selCol, colorTarget, c)) { version++; onEdited() }
                                    colorTarget = 0
                                },
                            contentAlignment = Alignment.Center,
                        ) { if (c < 0) Text("✕") }
                    }
                },
                confirmButton = { TextButton(onClick = { colorTarget = 0 }) { Text("Close") } },
            )
        }
        Grid(
            session = session,
            sheet = sheet,
            cache = cache,
            version = version,
            selRow = selRow,
            selCol = selCol,
            onSelect = { r, c -> commit(); selRow = r; selCol = c },
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
                        .clickable { commit(); sheet = index; selRow = 1; selCol = 1 }
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                    fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                )
            }
            item {
                TextButton(onClick = { if (session.addSheet()) { tabs = session.sheetNames; sheet = tabs.size - 1; onEdited() } }) { Text("+") }
            }
        }
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
                        val sx = gridLeft + colStartPx[(sc - 1).coerceIn(0, colCount - 1)] - offX
                        val sy = gridTop + (sr - 1) * rowHeightPx - offY
                        drawRect(primary, Offset(sx, sy), Size(colWidthsPx[(sc - 1).coerceIn(0, colCount - 1)], rowHeightPx), style = androidx.compose.ui.graphics.drawscope.Stroke(width = 3f))
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
