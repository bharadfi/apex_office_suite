package com.apexoffice.android.ui

import android.content.ClipData
import android.content.Intent
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.size
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import android.util.LruCache
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
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
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.apexoffice.android.pdf.Ocr
import com.apexoffice.android.pdf.OpenResult
import com.apexoffice.android.pdf.PdfDoc
import com.apexoffice.android.pdf.SignatureInfo
import com.apexoffice.android.pdf.SignatureVerifier
import com.apexoffice.android.pdf.TrustStore
import com.apexoffice.android.pdf.Verdict
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.FileOutputStream

private val bitmapCache = object : LruCache<String, Bitmap>(96 * 1024 * 1024) {
    override fun sizeOf(key: String, value: Bitmap) = value.byteCount
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PdfScreen(uri: Uri, name: String, onClose: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val trust = remember { TrustStore(context) }
    val wide = LocalWide.current

    var password by remember { mutableStateOf<String?>(null) }
    var askPassword by remember { mutableStateOf(false) }
    var doc by remember { mutableStateOf<PdfDoc?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var signatures by remember { mutableStateOf<List<SignatureInfo>>(emptyList()) }
    var trustedSet by remember { mutableStateOf(trust.all()) }
    var showSignatures by remember { mutableStateOf(false) }
    var ocrText by remember { mutableStateOf<String?>(null) }
    var ocrBusy by remember { mutableStateOf(false) }
    var askPage by remember { mutableStateOf(false) }

    LaunchedEffect(uri, password) {
        loading = true
        val result = withContext(Dispatchers.IO) { PdfDoc.open(context.contentResolver, uri, context.cacheDir, password) }
        when (result) {
            is OpenResult.Ok -> { doc = result.doc; error = null; askPassword = false }
            OpenResult.NeedsPassword -> {
                if (PdfDoc.supportsPasswords) askPassword = true
                else error = "This PDF is password-protected. Showing protected PDFs needs Android 15 or newer. Signatures can still be checked."
            }
            is OpenResult.Failed -> error = result.message
        }
        loading = false
    }
    val opened = doc
    androidx.compose.runtime.DisposableEffect(opened) { onDispose { opened?.close() } }

    // signatures are read from the raw file, so protected files are checked without their password
    LaunchedEffect(uri, trustedSet) {
        signatures = withContext(Dispatchers.Default) {
            runCatching {
                val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: ByteArray(0)
                SignatureVerifier.verify(bytes, trustedSet)
            }.getOrDefault(emptyList())
        }
    }

    val listState = rememberLazyListState()
    val currentPage by remember { derivedStateOf { listState.firstVisibleItemIndex } }
    var scale by remember { mutableFloatStateOf(1f) }

    BackHandler { onClose() }

    var chrome by remember { mutableStateOf(true) }
    var showTools by remember { mutableStateOf(false) }
    var toolsTab by remember { mutableStateOf("Tools") }
    var night by remember { mutableStateOf(false) }
    var pageTint by remember { mutableStateOf(Color.White) }
    val pageFilter = remember(night, pageTint) {
        when {
            night -> androidx.compose.ui.graphics.ColorFilter.colorMatrix(androidx.compose.ui.graphics.ColorMatrix(floatArrayOf(
                -1f, 0f, 0f, 0f, 255f,
                0f, -1f, 0f, 0f, 255f,
                0f, 0f, -1f, 0f, 255f,
                0f, 0f, 0f, 1f, 0f,
            )))
            pageTint != Color.White -> androidx.compose.ui.graphics.ColorFilter.tint(pageTint, androidx.compose.ui.graphics.BlendMode.Multiply)
            else -> null
        }
    }
    val worst = signatures.minByOrNull { sigRank(it.verdict) }

    val pdfTools: @Composable (String) -> Unit = { tab ->
            when (tab) {
                "Tools" -> {
                    ToolGroup("Extract PDF content") {
                        ToolRow {
                            ToolButton("A", if (ocrBusy) "Reading…" else "Extract Text", enabled = doc != null && !ocrBusy) {
                                val d = doc ?: return@ToolButton
                                showTools = false
                                ocrBusy = true
                                scope.launch {
                                    val text = withContext(Dispatchers.Default) {
                                        runCatching { Ocr.recognize(d.render(currentPage.coerceIn(0, d.pageCount - 1), 1800)) }
                                            .getOrElse { "Text recognition failed: ${it.message}" }
                                    }
                                    ocrText = text.ifBlank { "No text was found on this page." }
                                    ocrBusy = false
                                }
                            }
                            ToolButton("⎙", "Print", enabled = doc != null) { showTools = false; print(context, uri, name) }
                            ToolButton("⇪", "Share") {
                                showTools = false
                                val send = Intent(Intent.ACTION_SEND).apply {
                                    type = "application/pdf"; putExtra(Intent.EXTRA_STREAM, uri); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                }
                                runCatching { context.startActivity(Intent.createChooser(send, name)) }
                            }
                        }
                    }
                }
                "Fill & Sign" -> {
                    ToolGroup("Digital signatures") {
                        if (signatures.isEmpty()) {
                            ToolLine("This PDF carries no digital signatures.")
                        } else {
                            Column(Modifier.padding(6.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                for (sig in signatures) SignatureCard(
                                    sig, trusted = sig.fingerprint in trustedSet,
                                    onTrust = { trust.trust(sig.fingerprint); trustedSet = trust.all() },
                                    onUntrust = { trust.untrust(sig.fingerprint); trustedSet = trust.all() },
                                )
                                Text(
                                    "Trust is kept only on this device. A signature is checked against the exact bytes of the file.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.secondary,
                                )
                            }
                        }
                    }
                }
                else -> {
                    ToolGroup("Reading progress") {
                        val total = doc?.pageCount ?: 1
                        Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            androidx.compose.material3.Slider(
                                value = currentPage.toFloat(),
                                onValueChange = { v -> scope.launch { listState.scrollToItem(v.toInt().coerceIn(0, total - 1)) } },
                                valueRange = 0f..maxOf(1, total - 1).toFloat(),
                                modifier = Modifier.weight(1f),
                            )
                            Text("${currentPage + 1} / $total", modifier = Modifier.padding(start = 12.dp))
                        }
                    }
                    ToolGroup("Background") {
                        Row(Modifier.fillMaxWidth().padding(10.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                            for (c in listOf(Color.White, Color(0xFFD4EFDF), Color(0xFFFAE5C8), Color(0xFFE8DCB0), Color(0xFFC9C9C9))) {
                                Box(
                                    Modifier.size(40.dp).background(c, androidx.compose.foundation.shape.CircleShape)
                                        .border(if (pageTint == c && !night) 3.dp else 1.dp, if (pageTint == c && !night) Color(0xFF8DD4B1) else Color.Gray, androidx.compose.foundation.shape.CircleShape)
                                        .clickable { night = false; pageTint = c },
                                )
                            }
                        }
                    }
                    ToolGroup("Reading settings") {
                        ToolLine("Night mode") {
                            androidx.compose.material3.Switch(checked = night, onCheckedChange = { night = it })
                        }
                        ToolLine("Rotate screen", onClick = {
                            val activity = context as? android.app.Activity
                            activity?.requestedOrientation =
                                if (activity?.requestedOrientation == android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE)
                                    android.content.pm.ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                                else android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                        })
                        ToolLine("Fit to width", onClick = { scale = 1f; showTools = false })
                        ToolLine("Hide menus (tap the page to bring them back)", onClick = { showTools = false; chrome = false })
                    }
                }
            }
    }

    Column(Modifier.fillMaxSize().background(Color(0xFF202124)).statusBarsPadding().navigationBarsPadding()) {
        if (chrome) {
            ReaderTopBar(
                title = name,
                subtitle = doc?.let { "Page ${currentPage + 1} of ${it.pageCount}" },
                onBack = onClose,
                actions = {
                    BarAction("⎙", "Print", { print(context, uri, name) }, enabled = doc != null)
                    BarAction("⋮", "Tools", { toolsTab = "Tools"; showTools = true })
                },
            )
            if (worst != null) {
                val (tone, text) = sigBanner(worst.verdict, signatures.size)
                Row(
                    Modifier.fillMaxWidth().background(tone).clickable { toolsTab = "Fill & Sign"; showTools = true }.padding(horizontal = 14.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(text, color = Color.White, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                    Text("Details ›", color = Color.White, style = MaterialTheme.typography.labelLarge)
                }
            }
        }

        Row(Modifier.weight(1f)) {
        Box(Modifier.weight(1f)) {
        when {
            loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("Opening…") }
            doc == null -> Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(error ?: "This PDF could not be opened.", color = MaterialTheme.colorScheme.error)
                    if (signatures.isNotEmpty()) {
                        FilledTonalButton(onClick = { showSignatures = true }) { Text("Check signatures (${signatures.size})") }
                    }
                    Button(onClick = onClose) { Text("Back") }
                }
            }
            else -> {
                val d = doc!!
                BoxWithConstraints(
                    Modifier
                        .fillMaxSize()
                        .background(if (night) Color(0xFF111111) else Color(0xFFE4E7E5))
                        .pointerInput(Unit) { detectTapGestures(onTap = { chrome = !chrome }) }
                        .pointerInput(Unit) {
                            awaitEachGesture {
                                awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                                do {
                                    val event = awaitPointerEvent(PointerEventPass.Initial)
                                    if (event.changes.size >= 2) {
                                        val zoom = event.calculateZoom()
                                        if (zoom != 1f) {
                                            scale = (scale * zoom).coerceIn(1f, 4f)
                                            event.changes.forEach { it.consume() }
                                        }
                                    }
                                } while (event.changes.any { it.pressed })
                            }
                        },
                ) {
                    val density = LocalDensity.current
                    val viewWidthPx = with(density) { maxWidth.toPx() }
                    // pages render at the nearest quarter step; the bitmap is stretched between steps
                    val snapped = (Math.round(scale * 4f) / 4f)
                    val renderWidth = (viewWidthPx * snapped).toInt()
                    val displayWidth = with(density) { (viewWidthPx * scale).toDp() }
                    Box(Modifier.fillMaxSize().horizontalScroll(rememberScrollState())) {
                        LazyColumn(
                            state = listState,
                            modifier = Modifier.width(displayWidth),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 10.dp),
                        ) {
                            itemsIndexed(List(d.pageCount) { it }) { index, _ ->
                                PageView(d, index, renderWidth, displayWidth, d.ratios[index], pageFilter)
                            }
                        }
                    }
                }
            }
        }
        }
        if (wide) ToolsPanel(listOf("Tools", "Fill & Sign", "View"), toolsTab, { toolsTab = it }) { pdfTools(it) }
        }
        if (chrome) {
            ReaderBottomBar(
                listOf(
                    BottomItem("▤", "Reading Mode", enabled = doc != null) { chrome = false },
                    BottomItem("⌕", "Go to page", enabled = doc != null) { askPage = true },
                    BottomItem("🔏", "Signatures", selected = signatures.isNotEmpty()) { toolsTab = "Fill & Sign"; showTools = true },
                    BottomItem("⊞", "Tools") { toolsTab = "Tools"; showTools = true },
                ),
            )
        }
    }

    if (showTools && !wide) {
        ToolsSheet(tabs = listOf("Tools", "Fill & Sign", "View"), selected = toolsTab, onSelect = { toolsTab = it }, onDismiss = { showTools = false }) { tab -> pdfTools(tab) }
    }

    if (askPage) {
        var number by remember { mutableStateOf("") }
        val total = doc?.pageCount ?: 1
        AlertDialog(
            onDismissRequest = { askPage = false },
            title = { Text("Go to page") },
            text = {
                OutlinedTextField(
                    value = number,
                    onValueChange = { number = it.filter(Char::isDigit).take(6) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    label = { Text("1 to $total") },
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val n = (number.toIntOrNull() ?: 1).coerceIn(1, total)
                    askPage = false
                    scope.launch { listState.scrollToItem(n - 1) }
                }) { Text("Go") }
            },
            dismissButton = { TextButton(onClick = { askPage = false }) { Text("Cancel") } },
        )
    }

    if (askPassword) {
        var text by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = onClose,
            title = { Text("Password required") },
            text = {
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    label = { Text("Password") },
                )
            },
            confirmButton = { TextButton(onClick = { password = text }) { Text("Open") } },
            dismissButton = { TextButton(onClick = onClose) { Text("Cancel") } },
        )
    }

    if (showSignatures) {
        ModalBottomSheet(onDismissRequest = { showSignatures = false }) {
            Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("Digital signatures", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                for (sig in signatures) SignatureCard(sig, trusted = sig.fingerprint in trustedSet,
                    onTrust = { trust.trust(sig.fingerprint); trustedSet = trust.all() },
                    onUntrust = { trust.untrust(sig.fingerprint); trustedSet = trust.all() })
                Text(
                    "Trust is kept only on this device. A signature is checked against the exact bytes of the file.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.secondary,
                )
            }
        }
    }

    ocrText?.let { text ->
        ModalBottomSheet(onDismissRequest = { ocrText = null }) {
            Column(Modifier.padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Text on page ${currentPage + 1}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                Box(Modifier.height(320.dp)) {
                    androidx.compose.foundation.text.selection.SelectionContainer {
                        Text(text, Modifier.fillMaxWidth().verticalScroll(rememberScrollState()))
                    }
                }
                Button(onClick = {
                    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    cm.setPrimaryClip(ClipData.newPlainText("OCR text", text))
                    Toast.makeText(context, "Copied", Toast.LENGTH_SHORT).show()
                }) { Text("Copy") }
            }
        }
    }
}

@Composable
private fun PageView(doc: PdfDoc, index: Int, renderWidth: Int, displayWidth: androidx.compose.ui.unit.Dp, ratio: Float, filter: androidx.compose.ui.graphics.ColorFilter?) {
    val bitmap by produceState<Bitmap?>(null, doc, index, renderWidth) {
        val key = "${System.identityHashCode(doc)}:$index:$renderWidth"
        value = bitmapCache.get(key) ?: withContext(Dispatchers.Default) {
            runCatching { doc.render(index, renderWidth) }.getOrNull()?.also { bitmapCache.put(key, it) }
        }
    }
    val height = displayWidth * ratio
    Box(Modifier.width(displayWidth).height(height).background(Color.White)) {
        bitmap?.let {
            Image(it.asImageBitmap(), contentDescription = "Page ${index + 1}", contentScale = ContentScale.FillWidth, colorFilter = filter, modifier = Modifier.fillMaxSize())
        }
    }
}

@Composable
private fun SignatureCard(sig: SignatureInfo, trusted: Boolean, onTrust: () -> Unit, onUntrust: () -> Unit) {
    val (tone, mark) = when (sig.verdict) {
        Verdict.VALID_TRUSTED -> Color(0xFF1E8E5A) to "✓"
        Verdict.VALID_UNTRUSTED -> Color(0xFFB7791F) to "?"
        Verdict.VALID_MODIFIED -> Color(0xFFB7791F) to "!"
        Verdict.INVALID -> Color(0xFFC53030) to "✕"
        Verdict.UNREADABLE -> Color(0xFF718096) to "?"
    }
    Column(
        Modifier.fillMaxWidth().background(tone.copy(alpha = 0.08f), RoundedCornerShape(14.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.width(30.dp).height(30.dp).background(tone, RoundedCornerShape(15.dp)), contentAlignment = Alignment.Center) {
                Text(mark, color = Color.White, fontWeight = FontWeight.Bold)
            }
            Column {
                Text(sig.signer, fontWeight = FontWeight.SemiBold)
                Text(sig.label, color = tone, style = MaterialTheme.typography.bodyMedium)
            }
        }
        if (sig.issuer.isNotEmpty()) Text("Issued by ${sig.issuer}", style = MaterialTheme.typography.bodySmall)
        Text("Signed: ${sig.signedText}", style = MaterialTheme.typography.bodySmall)
        if (sig.fingerprint.isNotEmpty()) {
            Text("SHA-256: ${sig.fingerprint.chunked(8).joinToString(" ")}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary)
        }
        sig.detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        if (sig.fingerprint.isNotEmpty() && sig.verdict != Verdict.INVALID && sig.verdict != Verdict.UNREADABLE) {
            if (trusted) OutlinedButton(onClick = onUntrust) { Text("Stop trusting this signer") }
            else Button(onClick = onTrust) { Text("Trust this signer") }
        }
    }
}

private fun print(context: Context, uri: Uri, name: String) {
    val manager = context.getSystemService(Context.PRINT_SERVICE) as PrintManager
    manager.print(name, object : PrintDocumentAdapter() {
        override fun onLayout(old: PrintAttributes?, new: PrintAttributes?, cancel: CancellationSignal?, callback: LayoutResultCallback, extras: Bundle?) {
            if (cancel?.isCanceled == true) { callback.onLayoutCancelled(); return }
            callback.onLayoutFinished(PrintDocumentInfo.Builder(name).setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).build(), true)
        }

        override fun onWrite(pages: Array<out PageRange>?, destination: ParcelFileDescriptor, cancel: CancellationSignal?, callback: WriteResultCallback) {
            try {
                context.contentResolver.openInputStream(uri)?.use { input ->
                    FileOutputStream(destination.fileDescriptor).use { input.copyTo(it) }
                }
                callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
            } catch (e: Exception) {
                callback.onWriteFailed(e.message)
            }
        }
    }, null)
}

private fun sigRank(v: Verdict) = when (v) {
    Verdict.INVALID -> 0
    Verdict.VALID_MODIFIED -> 1
    Verdict.UNREADABLE -> 2
    Verdict.VALID_UNTRUSTED -> 3
    Verdict.VALID_TRUSTED -> 4
}

private fun sigBanner(v: Verdict, count: Int): Pair<Color, String> {
    val n = if (count == 1) "This document is digitally signed" else "This document has $count signatures"
    return when (v) {
        Verdict.VALID_TRUSTED -> Color(0xFF1E7D4F) to "$n. Signature valid, signer trusted."
        Verdict.VALID_UNTRUSTED -> Color(0xFF9A6A12) to "$n. Valid, but the signer is not trusted yet."
        Verdict.VALID_MODIFIED -> Color(0xFF9A6A12) to "$n. Changed after signing."
        Verdict.INVALID -> Color(0xFFB02A2A) to "$n. A signature is invalid."
        Verdict.UNREADABLE -> Color(0xFF5E6B78) to "$n. A signature could not be read."
    }
}