package com.apexoffice.android.ui

import android.content.ClipData
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

    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            TextButton(onClick = onClose) { Text("←") }
            Column(Modifier.weight(1f)) {
                Text(name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleMedium)
                doc?.let { Text("Page ${currentPage + 1} of ${it.pageCount}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary) }
            }
            if (signatures.isNotEmpty()) {
                FilledTonalButton(onClick = { showSignatures = true }) {
                    Text("Signatures (${signatures.size})")
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedButton(
                enabled = doc != null && !ocrBusy,
                onClick = {
                    val d = doc ?: return@OutlinedButton
                    ocrBusy = true
                    scope.launch {
                        val text = withContext(Dispatchers.Default) {
                            runCatching { Ocr.recognize(d.render(currentPage.coerceIn(0, d.pageCount - 1), 1800)) }
                                .getOrElse { "Text recognition failed: ${it.message}" }
                        }
                        ocrText = text.ifBlank { "No text was found on this page." }
                        ocrBusy = false
                    }
                },
            ) { Text(if (ocrBusy) "Reading…" else "Read text (OCR)") }
            OutlinedButton(enabled = doc != null, onClick = { print(context, uri, name) }) { Text("Print") }
            OutlinedButton(enabled = doc != null, onClick = { scale = 1f }) { Text("Fit width") }
            OutlinedButton(enabled = doc != null, onClick = { askPage = true }) { Text("Go to page") }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)

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
                        .background(Color(0xFFE4E7E5))
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
                                PageView(d, index, renderWidth, displayWidth, d.ratios[index])
                            }
                        }
                    }
                }
            }
        }
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
private fun PageView(doc: PdfDoc, index: Int, renderWidth: Int, displayWidth: androidx.compose.ui.unit.Dp, ratio: Float) {
    val bitmap by produceState<Bitmap?>(null, doc, index, renderWidth) {
        val key = "${System.identityHashCode(doc)}:$index:$renderWidth"
        value = bitmapCache.get(key) ?: withContext(Dispatchers.Default) {
            runCatching { doc.render(index, renderWidth) }.getOrNull()?.also { bitmapCache.put(key, it) }
        }
    }
    val height = displayWidth * ratio
    Box(Modifier.width(displayWidth).height(height).background(Color.White)) {
        bitmap?.let {
            Image(it.asImageBitmap(), contentDescription = "Page ${index + 1}", contentScale = ContentScale.FillWidth, modifier = Modifier.fillMaxSize())
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
