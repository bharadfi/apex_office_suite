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
        store = RecentFiles(this)
        recents = store.all()
        handleIntent(intent)

        setContent {
            val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
                if (uri != null) openUri(uri)
            }
            ApexTheme {
                ApexApp(
                    widthClass = calculateWindowSizeClass(this).widthSizeClass,
                    recents = recents,
                    openDocument = open,
                    onPickFile = { picker.launch(Formats.pickerMimeTypes) },
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
