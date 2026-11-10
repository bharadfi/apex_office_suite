package com.apexoffice.android.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.apexoffice.android.AppKind
import com.apexoffice.android.NewDocs
import com.apexoffice.android.Prefs
import com.apexoffice.android.RecentFile
import com.apexoffice.android.ThemeMode
import com.apexoffice.android.pdf.Ocr
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/** Phone home: search, quick actions, This Device / Recent tabs, and a + button for new files. */
@Composable
fun PhoneHome(
    recents: List<RecentFile>,
    onPickFile: () -> Unit,
    onNew: (AppKind) -> Unit,
    onOpenRecent: (RecentFile) -> Unit,
    onRemoveRecent: (RecentFile) -> Unit,
    onScan: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var query by remember { mutableStateOf("") }
    var tab by remember { mutableStateOf(0) }
    var choosing by remember { mutableStateOf(false) }
    val shown = recents.filter { query.isBlank() || it.name.contains(query, ignoreCase = true) }

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                placeholder = { Text("Search recent files") },
                shape = RoundedCornerShape(28.dp),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
            )
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                QuickChip("Open PDF", KindColors.pdf, onPickFile)
                QuickChip("Check signatures", KindColors.pdf, onPickFile)
                QuickChip("Scan text", KindColors.sheets, onScan)
                QuickChip("New document", KindColors.docs) { onNew(AppKind.DOCS) }
                QuickChip("New sheet", KindColors.sheets) { onNew(AppKind.SHEETS) }
                QuickChip("New slides", KindColors.slides) { onNew(AppKind.SLIDES) }
            }
            Row(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                for ((i, label) in listOf("This Device", "Recent").withIndex()) {
                    Column(Modifier.clickable { tab = i }.padding(vertical = 6.dp)) {
                        Text(label, fontWeight = if (tab == i) FontWeight.Bold else FontWeight.Normal, style = MaterialTheme.typography.titleMedium,
                            color = if (tab == i) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.secondary)
                        Box(Modifier.height(3.dp).size(width = 28.dp, height = 3.dp).background(if (tab == i) MaterialTheme.colorScheme.primary else Color.Transparent))
                    }
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
            if (tab == 0) {
                Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    FilledTonalButton(onClick = onPickFile, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp)) {
                        Text("Import from Local")
                    }
                    Text("Supported", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.secondary)
                    for (kind in AppKind.entries) {
                        Row(Modifier.fillMaxWidth().clickable { if (NewDocs.specs.containsKey(kind)) onNew(kind) else onPickFile() }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Box(Modifier.size(38.dp).background(kind.color(), RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
                                Text(kind.title.first().toString(), color = Color.White, fontWeight = FontWeight.Bold)
                            }
                            Column {
                                Text(kind.title, style = MaterialTheme.typography.bodyLarge)
                                Text(kind.extensionHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.secondary)
                            }
                        }
                    }
                }
            } else if (shown.isEmpty()) {
                Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                    Text(if (recents.isEmpty()) "No recent files. Import one to see it here." else "No file matches.", color = MaterialTheme.colorScheme.secondary)
                }
            } else {
                LazyColumn(Modifier.fillMaxSize()) {
                    items(shown, key = { it.uri }) { file ->
                        RecentRow(file, onOpen = { onOpenRecent(file) }, onRemove = { onRemoveRecent(file) })
                        HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
                    }
                }
            }
        }
        FloatingActionButton(
            onClick = { choosing = true },
            shape = CircleShape,
            containerColor = MaterialTheme.colorScheme.primary,
            modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp),
        ) { Text("+", style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.onPrimary) }
    }

    if (choosing) {
        AlertDialog(
            onDismissRequest = { choosing = false },
            title = { Text("Create new") },
            text = {
                Column {
                    for (kind in NewDocs.specs.keys) {
                        TextButton(onClick = { choosing = false; onNew(kind) }, modifier = Modifier.fillMaxWidth()) { Text(kind.title) }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { choosing = false; onPickFile() }) { Text("Open a file") } },
            dismissButton = { TextButton(onClick = { choosing = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun QuickChip(label: String, tint: Color, onClick: () -> Unit) {
    Box(
        Modifier.background(tint.copy(alpha = 0.14f), RoundedCornerShape(12.dp)).clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 12.dp),
    ) { Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface) }
}

/** Scan: photograph a page or pick an image, then read its text on the device. */
@Composable
fun ScanPane(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf<Uri?>(null) }

    fun recognise(uri: Uri) {
        busy = true
        scope.launch {
            val result = withContext(Dispatchers.Default) {
                runCatching {
                    val bmp = context.contentResolver.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it) }
                        ?: error("Could not read the picture")
                    Ocr.recognize(bmp)
                }.getOrElse { "Text recognition failed: ${it.message}" }
            }
            text = result.ifBlank { "No text was found." }
            busy = false
        }
    }

    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok -> if (ok) pending?.let(::recognise) }
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri -> if (uri != null) recognise(uri) }

    Column(modifier.fillMaxSize().statusBarsPadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Scan", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
        Text("Photograph a page or choose a picture and read its text. Nothing leaves this phone.", color = MaterialTheme.colorScheme.secondary)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(enabled = !busy, onClick = {
                val dir = File(context.cacheDir, "scans").also { it.mkdirs() }
                val uri = FileProvider.getUriForFile(context, context.packageName + ".files", File(dir, "scan-${System.currentTimeMillis()}.jpg"))
                pending = uri
                camera.launch(uri)
            }) { Text("Take photo") }
            OutlinedButton(enabled = !busy, onClick = { gallery.launch("image/*") }) { Text("Choose image") }
        }
        if (busy) Text("Reading…")
        text?.let { shown ->
            SelectionContainer(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) { Text(shown) }
            Button(onClick = {
                val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("Scanned text", shown))
                Toast.makeText(context, "Copied", Toast.LENGTH_SHORT).show()
            }) { Text("Copy") }
        }
    }
}

/** Settings: theme (system by default) and About. */
@Composable
fun SettingsPane(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    Column(modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Settings", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
        Text("Appearance", style = MaterialTheme.typography.titleMedium)
        for (mode in ThemeMode.entries) {
            Row(
                Modifier.fillMaxWidth().clickable { Prefs.setTheme(context, mode) },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(selected = Prefs.theme == mode, onClick = { Prefs.setTheme(context, mode) })
                Text(if (mode == ThemeMode.SYSTEM) "Follow system" else mode.label, style = MaterialTheme.typography.bodyLarge)
            }
        }
        HorizontalDivider()
        Text("About", style = MaterialTheme.typography.titleMedium)
        Text("Apex Office for Android", fontWeight = FontWeight.SemiBold)
        Text("Version " + (runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: ""))
        Text("App developed by Mr. Falguni Bharadwaj")
        Text("Everything stays on this device.", color = MaterialTheme.colorScheme.secondary)
    }
}
