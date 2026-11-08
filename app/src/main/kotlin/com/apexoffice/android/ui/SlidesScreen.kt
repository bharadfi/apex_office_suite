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

    Column(Modifier.fillMaxSize().then(if (present) Modifier.background(Color.Black) else Modifier.statusBarsPadding().navigationBarsPadding())) {
        if (!present) TopBar(name, dirty, onBack = { if (dirty) askLeave = true else onClose() }, onSave = { askSave = true }, canSave = deck != null && dirty)
        val d = deck
        when {
            error != null -> ErrorBox(error!!, onClose)
            d == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Opening…") }
            d.slides.isEmpty() -> ErrorBox("This presentation has no slides.", onClose)
            else -> SlideViewer(d, version, present, onPresent = { present = true }, onExit = { present = false }, onEdit = { slide, shape -> editing = slide to shape })
        }
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
    @Suppress("UNUSED_EXPRESSION") scope
}

@Composable
private fun SlideViewer(deck: Deck, version: Int, present: Boolean, onPresent: () -> Unit, onExit: () -> Unit, onEdit: (Slide, Shape) -> Unit) {
    val pager = rememberPagerState { deck.slides.size }
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
                        androidx.compose.material3.TextButton(onClick = onPresent) { Text("Present") }
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
