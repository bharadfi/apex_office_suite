package com.apexoffice.android

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.windowsizeclass.ExperimentalMaterial3WindowSizeClassApi
import androidx.compose.material3.windowsizeclass.calculateWindowSizeClass
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.apexoffice.android.ui.ApexApp
import com.apexoffice.android.ui.ApexTheme

class MainActivity : ComponentActivity() {
    private lateinit var store: RecentFiles
    private var recents by mutableStateOf(emptyList<RecentFile>())
    private var open by mutableStateOf<RecentFile?>(null)

    @OptIn(ExperimentalMaterial3WindowSizeClassApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        Prefs.load(this)
        store = RecentFiles(this)
        recents = store.all()
        handleIntent(intent)

        setContent {
            val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
                if (uri != null) openUri(uri)
            }
            val creators = NewDocs.specs.mapValues { (kind, spec) ->
                rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(spec.mime)) { uri ->
                    if (uri != null) createBlank(kind, uri)
                }
            }
            ApexTheme {
                ApexApp(
                    widthClass = calculateWindowSizeClass(this).widthSizeClass,
                    recents = recents,
                    openDocument = open,
                    onPickFile = { picker.launch(Formats.pickerMimeTypes) },
                    onNew = { kind -> creators[kind]?.launch(NewDocs.specs.getValue(kind).fileName) },
                    onOpenRecent = { open = it },
                    onRemoveRecent = { store.remove(it.uri); recents = store.all() },
                    onCloseDocument = { open = null },
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        if (intent?.action == Intent.ACTION_VIEW) intent.data?.let(::openUri)
        // debug builds only: open a test file kept in the app's own folder (no picker, no user files)
        if ((applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            intent?.getStringExtra("apex_debug_open")?.let { name ->
                val file = java.io.File(filesDir, name)
                if (file.exists()) open = store.add(Uri.fromFile(file))
            }
        }
    }

    private fun createBlank(kind: AppKind, uri: Uri) {
        val bytes = NewDocs.bytes(kind)
        val ok = bytes != null && runCatching {
            contentResolver.openOutputStream(uri, "wt")?.use { it.write(bytes) } != null
        }.getOrDefault(false)
        if (ok) openUri(uri) else android.widget.Toast.makeText(this, "Could not create the file", android.widget.Toast.LENGTH_SHORT).show()
    }

    private fun openUri(uri: Uri) {
        // keep access across restarts when the provider allows it; one-shot grants still open now
        runCatching {
            contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
            )
        }.recoverCatching {
            contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        open = store.add(uri)
        recents = store.all()
    }
}
