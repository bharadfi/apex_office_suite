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
) {
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
    BackHandler { onClose() }
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
                WebView.setWebContentsDebuggingEnabled(true)
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.allowFileAccess = false
                settings.cacheMode = WebSettings.LOAD_DEFAULT
                settings.useWideViewPort = false
                settings.loadWithOverviewMode = false
                settings.setSupportZoom(true)
                settings.builtInZoomControls = true
                settings.displayZoomControls = false
                addJavascriptInterface(DocsHost(ctx, uri, name), "AndroidHost")
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
