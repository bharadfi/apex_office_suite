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
    private val onPreview: (String) -> Unit = {},
    private val appDir: String = "docs",
    private val webView: () -> WebView? = { null },
) {
    private val main = android.os.Handler(android.os.Looper.getMainLooper())
    private var pending: String? = null
    private val root = java.io.File(context.filesDir, "rt").apply { mkdirs() }
    private var sessionFile: java.io.File? = null
    private var copiedAt = 0L
    private var process: Process? = null

    init {
        pending = runCatching {
            val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return@runCatching null
            val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            // the workbook engine is a separate process that opens files by path, so the document gets a real path
            var real = ""
            if (appDir == "sheets") {
                val f = java.io.File(root, "session/$name").apply { parentFile?.mkdirs(); writeBytes(bytes) }
                sessionFile = f
                copiedAt = f.lastModified()
                real = f.absolutePath
            }
            val b64 = if (appDir == "sheets") "" else Base64.encodeToString(bytes, Base64.NO_WRAP)
            """{"path":${quote(uri.toString())},"realPath":${quote(real)},"name":${quote(name)},"hash":"$hash","base64":"$b64"}"""
        }.getOrNull()
    }

    private fun quote(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""


    // ---- a question with buttons, answered by the person using the phone ----
    @JavascriptInterface
    fun showDialog(json: String) {
        main.post {
            val o = org.json.JSONObject(json)
            val labels = o.getJSONArray("buttons")
            val answer = { i: Int -> webView()?.evaluateJavascript("window.__dialogAnswer($i)", null); Unit }
            val b = android.app.AlertDialog.Builder(context).setTitle(o.optString("message")).setMessage(o.optString("detail")).setCancelable(false)
            if (labels.length() > 0) b.setPositiveButton(labels.getString(0)) { _, _ -> answer(0) }
            if (labels.length() > 1) b.setNegativeButton(labels.getString(1)) { _, _ -> answer(1) }
            if (labels.length() > 2) b.setNeutralButton(labels.getString(2)) { _, _ -> answer(2) }
            b.show()
        }
    }

    // ---- real files for the page (paths under the app's own folder only) ----
    private fun inside(path: String): java.io.File? {
        val f = java.io.File(path).canonicalFile
        return if (f.path == root.canonicalPath || f.path.startsWith(root.canonicalPath + "/")) f else null
    }

    private fun copyBack() {
        val f = sessionFile ?: return
        if (f.lastModified() == copiedAt || !f.exists()) return
        runCatching {
            context.contentResolver.openOutputStream(uri, "wt")?.use { it.write(f.readBytes()) }
            copiedAt = f.lastModified()
        }
    }

    @JavascriptInterface
    fun realRoot(): String = root.absolutePath

    @JavascriptInterface
    fun fsExists(path: String): Boolean = inside(path)?.exists() == true

    @JavascriptInterface
    fun fsRead(path: String): String? = inside(path)?.takeIf { it.isFile }?.let { Base64.encodeToString(it.readBytes(), Base64.NO_WRAP) }

    @JavascriptInterface
    fun fsWrite(path: String, base64: String): Boolean = runCatching {
        val f = inside(path) ?: return false
        f.parentFile?.mkdirs()
        f.writeBytes(Base64.decode(base64, Base64.DEFAULT))
        if (f == sessionFile?.canonicalFile) copyBack()
        true
    }.getOrDefault(false)

    @JavascriptInterface
    fun fsMkdir(path: String): Boolean = inside(path)?.mkdirs() == true || inside(path)?.isDirectory == true

    @JavascriptInterface
    fun fsRemove(path: String): Boolean = inside(path)?.let { it.exists() && it.deleteRecursively() } == true

    @JavascriptInterface
    fun fsList(path: String): String {
        val dir = inside(path)?.takeIf { it.isDirectory } ?: return "[]"
        return (dir.listFiles() ?: emptyArray()).joinToString(",", "[", "]") { """{"name":${quote(it.name)},"dir":${it.isDirectory}}""" }
    }

    @JavascriptInterface
    fun fsStat(path: String): String? = inside(path)?.takeIf { it.exists() }?.let { """{"size":${it.length()},"mtime":${it.lastModified()},"dir":${it.isDirectory}}""" }

    @JavascriptInterface
    fun fsRename(from: String, to: String): Boolean = runCatching {
        val a = inside(from) ?: return false
        val b = inside(to) ?: return false
        b.parentFile?.mkdirs()
        val ok = a.renameTo(b) || (a.copyTo(b, overwrite = true).exists() && a.delete())
        if (ok && b == sessionFile?.canonicalFile) copyBack()
        ok
    }.getOrDefault(false)

    // ---- the workbook engine, a native program the page talks to over lines of text ----
    @JavascriptInterface
    fun sidecarStart(): Boolean {
        process?.takeIf { it.isAlive }?.let { return true }
        val binary = java.io.File(context.applicationInfo.nativeLibraryDir, "libxlsx_sidecar.so")
        if (!binary.exists()) return false
        val p = ProcessBuilder(binary.absolutePath).redirectErrorStream(false).start()
        process = p
        fun send(js: String) = main.post { webView()?.evaluateJavascript(js, null) }
        Thread {
            p.inputStream.bufferedReader().forEachLine { line ->
                copyBack()
                send("window.__sidecarOut(" + org.json.JSONObject.quote(line) + ")")
            }
        }.start()
        Thread { p.errorStream.bufferedReader().forEachLine { line -> send("window.__sidecarErr(" + org.json.JSONObject.quote(line + "\n") + ")") } }.start()
        Thread {
            val code = p.waitFor()
            send("window.__sidecarExit($code)")
        }.start()
        return true
    }

    @JavascriptInterface
    fun sidecarWrite(line: String) {
        val out = process?.outputStream ?: return
        synchronized(out) { out.write((line + "\n").toByteArray(Charsets.UTF_8)); out.flush() }
    }

    @JavascriptInterface
    fun sidecarKill() {
        process?.destroy()
        process = null
    }
    @JavascriptInterface
    fun takePending(): String? = pending.also { pending = null }

    @JavascriptInterface
    fun closeChecked(dirty: Boolean) { main.post { onChecked(dirty) } }

    @JavascriptInterface
    fun refuse(reason: String) { main.post { onRefused(reason) } }

    @JavascriptInterface
    fun pickImage() { main.post { onPickImage() } }

    @JavascriptInterface
    fun updatePreview(text: String) { onPreview(text) }

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
fun DocsWebScreen(uri: Uri, name: String, onClose: () -> Unit, appDir: String = "docs") {
    // the HTML editor's live preview is served from the latest text the editor pushed
    var previewHtml by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf("") }
    val context = LocalContext.current
    var web by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf<WebView?>(null) }
    var asking by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    // leave straight away when nothing is unsaved; otherwise ask what to do with the changes
    BackHandler {
        val view = web
        if (view == null) onClose()
        else if (appDir == "slides" || appDir == "sheets" || appDir == "pdf") view.evaluateJavascript("window.__apexClose ? window.__apexClose() : null", null)
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
                // document passwords must never be offered to a password manager
                importantForAutofill = android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
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
                addJavascriptInterface(DocsHost(ctx, uri, name, { dirty -> if (dirty) asking = true else onClose() }, { onClose() }, { reason -> android.widget.Toast.makeText(ctx, reason, android.widget.Toast.LENGTH_LONG).show(); onClose() }, { pickPicture.launch("image/*") }, { previewHtml = it }, appDir, { web }), "AndroidHost")
                webChromeClient = object : WebChromeClient() {
                    override fun onConsoleMessage(m: android.webkit.ConsoleMessage): Boolean {
                        android.util.Log.d("ApexDocsWeb", "${m.messageLevel()} ${m.message()} (${m.sourceId()}:${m.lineNumber()})")
                        return true
                    }
                }
                webViewClient = object : WebViewClient() {
                    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                        if (request.url.path?.startsWith("/__preview__/") == true) WebResourceResponse("text/html", "utf-8", java.io.ByteArrayInputStream(previewHtml.toByteArray(Charsets.UTF_8))) else loader.shouldInterceptRequest(request.url)
                }
                loadUrl("https://appassets.androidplatform.net/$appDir/android.html")
            }
        },
    )
}
