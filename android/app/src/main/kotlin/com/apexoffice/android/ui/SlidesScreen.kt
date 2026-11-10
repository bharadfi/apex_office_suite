package com.apexoffice.android.ui

import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.apexoffice.android.Formats
import com.apexoffice.android.slides.Deck
import com.apexoffice.android.slides.Shape
import com.apexoffice.android.slides.Slide
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"

@Composable
fun SlidesScreen(uri: Uri, name: String, onClose: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var deck by remember { mutableStateOf<Deck?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var version by remember { mutableIntStateOf(0) }
    var dirty by remember { mutableStateOf(false) }
    var askSave by remember { mutableStateOf(false) }
    var askLeave by remember { mutableStateOf(false) }
    var present by remember { mutableStateOf(false) }
    var page by remember { mutableIntStateOf(0) }
    var startPage by remember { mutableIntStateOf(0) }
    var confirmDelete by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<Pair<Slide, Shape>?>(null) }
    val stem = name.substringBeforeLast('.')

    LaunchedEffect(uri) {
        val ext = Formats.extensionOf(name)
        if (ext !in setOf("pptx", "pptm", "ppsx", "ppsm", "potx", "potm")) {
            error = "Opening .$ext files in Slides is not available yet. PowerPoint .pptx, .pptm, .ppsx, .potx and similar open here."
            return@LaunchedEffect
        }
        val result = withContext(Dispatchers.IO) {
            runCatching {
                val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: error("The file could not be read.")
                Deck.read(bytes)
            }
        }
        result.onSuccess { deck = it }.onFailure { error = it.message ?: "This presentation could not be opened." }
    }

    fun write(target: Uri): Boolean {
        val d = deck ?: return false
        return try {
            val bytes = d.write()
            context.contentResolver.openOutputStream(target, "wt")?.use { it.write(bytes) } != null
        } catch (e: Exception) {
            false
        }
    }
    val saveCopy = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(PPTX_MIME)) { target ->
        if (target != null) {
            val ok = write(target)
            Toast.makeText(context, if (ok) "Saved" else "Could not save", Toast.LENGTH_SHORT).show()
            if (ok) dirty = false
        }
    }
    BackHandler { if (present) present = false else if (dirty) askLeave = true else onClose() }

    val wide = LocalWide.current
    var canEdit by remember { mutableStateOf(wide) }
    var showTools by remember { mutableStateOf(false) }
    var toolsTab by remember { mutableStateOf("Home") }
    fun duplicateSlide() {
        val d = deck ?: return
        scope.launch {
            val next = withContext(Dispatchers.Default) { runCatching { Deck.read(d.withDuplicate(page)) }.getOrNull() }
            if (next != null) { startPage = page + 1; deck = next; version++; dirty = true }
            else Toast.makeText(context, "Could not duplicate this slide", Toast.LENGTH_SHORT).show()
        }
    }

    val slideTools: @Composable (String) -> Unit = { tab ->
            if (tab == "Home") {
                if (!canEdit) {
                    ToolGroup("Read-only") {
                        ToolLine("Tap Edit to change this presentation.", onClick = { canEdit = true; showTools = false }) { Text("Edit ›", color = Color(0xFF8DD4B1)) }
                    }
                } else {
                    ToolGroup("Slides") {
                        ToolRow {
                            ToolButton("⧉", "Duplicate slide") { showTools = false; duplicateSlide() }
                            ToolButton("🗑", "Delete slide") { showTools = false; confirmDelete = true }
                        }
                    }
                    ToolGroup("Text") { ToolLine("Tap a text box on the slide to edit its text.") }
                }
            } else {
                ToolGroup("Slide show") {
                    ToolRow { ToolButton("▶", "Present", enabled = deck != null) { showTools = false; present = true } }
                }
            }
    }

    Column(Modifier.fillMaxSize().then(if (present) Modifier.background(Color.Black) else Modifier.background(MaterialTheme.colorScheme.surface).statusBarsPadding().navigationBarsPadding())) {
        if (!present) ReaderTopBar(
            title = name + if (dirty) " •" else "",
            subtitle = if (canEdit) "Editing" else "Read-only",
            onBack = { if (dirty) askLeave = true else onClose() },
            actions = { if (canEdit) BarAction("💾", "Save", { askSave = true }, enabled = deck != null && dirty) },
        )
        val d = deck
        Row(Modifier.weight(1f)) {
        Box(Modifier.weight(1f)) {
        when {
            error != null -> ErrorBox(error!!, onClose)
            d == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Opening…") }
            d.slides.isEmpty() -> ErrorBox("This presentation has no slides.", onClose)
            else -> androidx.compose.runtime.key(d) {
                SlideViewer(
                    d, version, present, startPage,
                    onPage = { page = it },
                    onPresent = { present = true },
                    onExit = { present = false },
                    canEdit = canEdit,
                    onEdit = { slide, shape -> editing = slide to shape },
                )
            }
        }
        }
        if (wide && !present) ToolsPanel(listOf("Home", "View"), toolsTab, { toolsTab = it }) { slideTools(it) }
        }
        if (!present) ReaderBottomBar(
            if (!canEdit) listOf(
                BottomItem("✎", "Edit", enabled = deck != null) { canEdit = true },
                BottomItem("▶", "Present", enabled = deck != null) { present = true },
                BottomItem("⊞", "Tools") { toolsTab = "Home"; showTools = true },
                BottomItem("⇪", "Share") {
                    val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                        type = PPTX_MIME; putExtra(android.content.Intent.EXTRA_STREAM, uri); addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    runCatching { context.startActivity(android.content.Intent.createChooser(send, name)) }
                },
            ) else listOf(
                BottomItem("✓", "Done", selected = true) { canEdit = false },
                BottomItem("▶", "Present", enabled = deck != null) { present = true },
                BottomItem("⊞", "Tools") { toolsTab = "Home"; showTools = true },
                BottomItem("💾", "Save", enabled = deck != null && dirty) { askSave = true },
            ),
        )
    }

    editing?.let { (slide, shape) ->
        val d = deck!!
        var text by remember(shape) { mutableStateOf(d.paragraphsOf(shape).joinToString("\n")) }
        AlertDialog(
            onDismissRequest = { editing = null },
            title = { Text("Edit text") },
            text = {
                OutlinedTextField(value = text, onValueChange = { text = it }, modifier = Modifier.fillMaxWidth(), minLines = 3, maxLines = 10)
            },
            confirmButton = {
                TextButton(onClick = {
                    d.setText(slide, shape, text.split('\n'))
                    version++
                    dirty = true
                    editing = null
                }) { Text("Apply") }
            },
            dismissButton = { TextButton(onClick = { editing = null }) { Text("Cancel") } },
        )
    }

    if (askSave) {
        AlertDialog(
            onDismissRequest = { askSave = false },
            title = { Text("Save presentation") },
            text = { Text("Only the text you changed is rewritten; layouts, pictures and themes stay as they were. Saving a copy leaves your original untouched.") },
            confirmButton = { TextButton(onClick = { askSave = false; saveCopy.launch("$stem (Apex).pptx") }) { Text("Save a copy") } },
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
    LeaveDialog(askLeave, { askLeave = false }, onSave = { askLeave = false; askSave = true }, onDiscard = { askLeave = false; onClose() })
    if (showTools && !wide) {
        ToolsSheet(tabs = listOf("Home", "View"), selected = toolsTab, onSelect = { toolsTab = it }, onDismiss = { showTools = false }) { tab -> slideTools(tab) }
    }
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Delete this slide?") },
            text = { Text("Slide ${page + 1} is removed from the presentation. Save a copy if you want to keep the original.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    val d = deck ?: return@TextButton
                    if (d.slides.size <= 1) { Toast.makeText(context, "A presentation needs at least one slide", Toast.LENGTH_SHORT).show(); return@TextButton }
                    scope.launch {
                        val next = withContext(Dispatchers.Default) { runCatching { Deck.read(d.withoutSlide(page)) }.getOrNull() }
                        if (next != null) { startPage = (page - 1).coerceAtLeast(0); deck = next; version++; dirty = true }
                        else Toast.makeText(context, "Could not delete this slide", Toast.LENGTH_SHORT).show()
                    }
                }) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun SlideViewer(
    deck: Deck, version: Int, present: Boolean, startPage: Int,
    onPage: (Int) -> Unit, onPresent: () -> Unit, onExit: () -> Unit,
    canEdit: Boolean, onEdit: (Slide, Shape) -> Unit,
) {
    val pager = rememberPagerState(initialPage = startPage.coerceIn(0, deck.slides.size - 1)) { deck.slides.size }
    LaunchedEffect(pager.currentPage) { onPage(pager.currentPage) }
    val scope = rememberCoroutineScope()
    val thumbs = rememberLazyListState()
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth >= 600.dp && !present
        Row(Modifier.fillMaxSize()) {
            if (wide) {
                LazyColumn(
                    state = thumbs,
                    modifier = Modifier.width(190.dp).fillMaxHeight().background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)),
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(10.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    itemsIndexed(deck.slides) { index, slide ->
                        Column(
                            Modifier.clickable { scope.launch { pager.animateScrollToPage(index) } },
                            verticalArrangement = Arrangement.spacedBy(2.dp),
                        ) {
                            Box(
                                Modifier.border(
                                    if (pager.currentPage == index) 3.dp else 1.dp,
                                    if (pager.currentPage == index) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                                    RoundedCornerShape(4.dp),
                                ),
                            ) { SlideImage(deck, slide, 360, version, Modifier.fillMaxWidth()) }
                            Text("${index + 1}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.secondary)
                        }
                    }
                }
            }
            Column(Modifier.weight(1f).fillMaxHeight()) {
                HorizontalPager(state = pager, modifier = Modifier.weight(1f).fillMaxWidth().background(if (present) Color.Black else Color(0xFFE4E7E5)), contentPadding = androidx.compose.foundation.layout.PaddingValues(if (present) 0.dp else 12.dp), pageSpacing = 12.dp) { page ->
                    val slide = deck.slides[page]
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        SlideImage(deck, slide, 1600, version, Modifier.fillMaxWidth().border(1.dp, Color(0xFFB8C0BB)), onTap = { fx, fy ->
                            // topmost text shape under the tap
                            if (!present && !canEdit) return@SlideImage
                            if (present) { scope.launch { pager.animateScrollToPage((pager.currentPage + 1).coerceAtMost(deck.slides.size - 1)) }; return@SlideImage }
                            val ex = (fx * deck.width).toLong()
                            val ey = (fy * deck.height).toLong()
                            slide.shapes.lastOrNull { s -> s.hasText && ex in s.frame.x..(s.frame.x + s.frame.w) && ey in s.frame.y..(s.frame.y + s.frame.h) }
                                ?.let { onEdit(slide, it) }
                        })
                    }
                }
                if (present) {
                    Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Text("${pager.currentPage + 1} / ${deck.slides.size}  •  tap the slide for the next one", color = Color(0xFFB8C0BB), style = MaterialTheme.typography.bodySmall)
                        TextButton(onClick = onExit) { Text("Exit", color = Color.White) }
                    }
                } else Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    OutlinedButton(onClick = { scope.launch { pager.animateScrollToPage((pager.currentPage - 1).coerceAtLeast(0)) } }, enabled = pager.currentPage > 0) { Text("←") }
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("Slide ${pager.currentPage + 1} of ${deck.slides.size}", style = MaterialTheme.typography.bodyMedium)
                        Row {
                            if (canEdit) Text("Tap a text box to edit it", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.secondary)
                        }
                    }
                    OutlinedButton(onClick = { scope.launch { pager.animateScrollToPage((pager.currentPage + 1).coerceAtMost(deck.slides.size - 1)) } }, enabled = pager.currentPage < deck.slides.size - 1) { Text("→") }
                }
            }
        }
    }
}

@Composable
private fun SlideImage(deck: Deck, slide: Slide, widthPx: Int, version: Int, modifier: Modifier, onTap: ((Float, Float) -> Unit)? = null) {
    val bitmap by produceState<Bitmap?>(null, deck, slide, widthPx, version) {
        value = withContext(Dispatchers.Default) {
            val h = (widthPx * deck.height.toFloat() / deck.width).toInt().coerceAtLeast(1)
            val bmp = Bitmap.createBitmap(widthPx, h, Bitmap.Config.ARGB_8888)
            synchronized(deck) { deck.draw(Canvas(bmp), slide, widthPx.toFloat()) }
            bmp
        }
    }
    val ratio = deck.width.toFloat() / deck.height
    Box(modifier.aspectRatio(ratio).background(Color.White).then(
        if (onTap != null) Modifier.pointerInput(slide) { detectTapGestures { pos -> onTap(pos.x / size.width, pos.y / size.height) } } else Modifier,
    )) {
        bitmap?.let { Image(it.asImageBitmap(), contentDescription = "Slide", contentScale = ContentScale.FillBounds, modifier = Modifier.fillMaxSize()) }
    }
}
