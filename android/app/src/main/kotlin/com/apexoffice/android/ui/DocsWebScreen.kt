package com.apexoffice.android.ui

import android.annotation.SuppressLint
import android.net.Uri
import android.util.Base64
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewAssetLoader
import java.security.MessageDigest

/**
 * Word on the phone: the desktop Word editor itself (page layout, pictures, tables, ribbon),
 * built for a browser and run in a WebView. This class plays the part Electron's main process
 * plays on desktop: it hands the editor the opened file and stores what the editor saves.
 */
private class DocsHost(
    private val context: android.content.Context,
    private val uri: Uri,
    private val name: String,
    private val onChecked: (Boolean) -> Unit,
    private val onSaved: (Boolean) -> Unit,
    private val onRefused: (String) -> Unit,
    private val onPickImage: () -> Unit,
) {
    private val main = android.os.Handler(android.os.Looper.getMainLooper())
    private var pending: String? = null

    init {
        pending = runCatching {
            val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return@runCatching null
            val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
            """{"path":${quote(uri.toString())},"name":${quote(name)},"hash":"$hash","base64":"$b64"}"""
        }.getOrNull()
    }

    private fun quote(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

    @JavascriptInterface
    fun takePending(): String? = pending.also { pending = null }

    @JavascriptInterface
    fun closeChecked(dirty: Boolean) { main.post { onChecked(dirty) } }

    @JavascriptInterface
    fun refuse(reason: String) { main.post { onRefused(reason) } }

    @JavascriptInterface
    fun pickImage() { main.post { onPickImage() } }

    @JavascriptInterface
    fun saveDone(ok: Boolean) { main.post { onSaved(ok) } }

    @JavascriptInterface
    fun language(): String = java.util.Locale.getDefault().language

    @JavascriptInterface
    fun save(path: String, base64: String): Boolean = try {
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        context.contentResolver.openOutputStream(uri, "wt")?.use { it.write(bytes) } != null
    } catch (e: Exception) {
        false
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun DocsWebScreen(uri: Uri, name: String, onClose: () -> Unit) {
    val context = LocalContext.current
    var web by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<WebView?>(null) }
    var asking by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    // leave straight away when nothing is unsaved; otherwise ask what to do with the changes
    BackHandler {
        val view = web
        if (view == null) onClose()
        else view.evaluateJavascript("window.__apexCloseCheck && window.__apexCloseCheck()", null)
    }
    if (asking) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { asking = false },
            title = { androidx.compose.material3.Text("Save changes?") },
            text = { androidx.compose.material3.Text("$name has changes that are not saved.") },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = {
                    asking = false
                    web?.evaluateJavascript("window.__apexSave()", null) ?: onClose()
                }) { androidx.compose.material3.Text("Save") }
            },
            dismissButton = {
                androidx.compose.foundation.layout.Row {
                    androidx.compose.material3.TextButton(onClick = { asking = false }) { androidx.compose.material3.Text("Cancel") }
                    androidx.compose.material3.TextButton(onClick = { asking = false; onClose() }) { androidx.compose.material3.Text("Discard") }
                }
            },
        )
    }
    val pickPicture = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.GetContent()) { picked ->
        val view = web
        if (picked == null || view == null) { view?.evaluateJavascript("window.__apexImagePicked(null)", null); return@rememberLauncherForActivityResult }
        val reply = runCatching {
            val mime = context.contentResolver.getType(picked) ?: "image/png"
            val bytes = context.contentResolver.openInputStream(picked)?.use { it.readBytes() }
            val kind = when { mime.contains("jpeg") || mime.contains("jpg") -> "image/jpeg"; mime.contains("gif") -> "image/gif"; else -> "image/png" }
            if (bytes == null) null else "{\"base64\":\"" + Base64.encodeToString(bytes, Base64.NO_WRAP) + "\",\"mime\":\"$kind\",\"name\":\"image\"}"
        }.getOrNull()
        view.evaluateJavascript("window.__apexImagePicked(" + (reply?.let { org.json.JSONObject.quote(it) } ?: "null") + ")", null)
    }
    val loader = remember {
        WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(context))
            .build()
    }
    AndroidView(
        modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding(),
        factory = { ctx ->
            WebView(ctx).apply {
                web = this
                // inspectable from a computer only in debug builds
                WebView.setWebContentsDebuggingEnabled((ctx.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0)
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.allowFileAccess = false
                settings.cacheMode = WebSettings.LOAD_DEFAULT
                settings.useWideViewPort = false
                settings.loadWithOverviewMode = false
                settings.setSupportZoom(true)
                settings.builtInZoomControls = true
                settings.displayZoomControls = false
                addJavascriptInterface(DocsHost(ctx, uri, name, { dirty -> if (dirty) asking = true else onClose() }, { onClose() }, { reason -> android.widget.Toast.makeText(ctx, reason, android.widget.Toast.LENGTH_LONG).show(); onClose() }, { pickPicture.launch("image/*") }), "AndroidHost")
                webChromeClient = object : WebChromeClient() {
                    override fun onConsoleMessage(m: android.webkit.ConsoleMessage): Boolean {
                        android.util.Log.d("ApexDocsWeb", "${m.messageLevel()} ${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                        return true
                    }
                }
                webViewClient = object : WebViewClient() {
                    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                        loader.shouldInterceptRequest(request.url)
                }
                loadUrl("https://appassets.androidplatform.net/docs/android.html")
            }
        },
    )
}
