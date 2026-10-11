package com.websitetoapp.shell

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Message
import android.view.View
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import java.io.ByteArrayInputStream

/**
 * The single screen of the generated app: a WebView restricted to the configured website.
 *
 * Navigation policy is applied to top-level page loads only; ordinary subresources (scripts,
 * images, fonts, API calls) are never filtered. This is a practical restricted-navigation wrapper
 * for a site the app owner trusts, not a network sandbox. See the README for known limitations
 * (notably form POST navigations, which shouldOverrideUrlLoading never sees).
 */
class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private lateinit var refreshLayout: SwipeRefreshLayout
    private lateinit var progressBar: ProgressBar
    private lateinit var errorView: View
    private lateinit var errorBody: TextView
    private lateinit var retryButton: Button

    private var config: AppConfig? = null
    private var policy: NavigationPolicy? = null

    // Main-frame load bookkeeping, used to tell a failed page load from an incidental failed image.
    private var currentLoadUrl: String? = null
    private var failedUrl: String? = null
    private var loadFailed = false
    private var skipStateSave = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        refreshLayout = findViewById(R.id.refreshLayout)
        progressBar = findViewById(R.id.progressBar)
        errorView = findViewById(R.id.errorView)
        errorBody = findViewById(R.id.errorBody)
        retryButton = findViewById(R.id.retryButton)
        applySystemBarInsets(findViewById(R.id.root))

        val loaded = try {
            AppConfig.parse(assets.open(CONFIG_ASSET).bufferedReader().use { it.readText() })
        } catch (e: Exception) {
            return showFatal(getString(R.string.config_error))
        }
        val navigationPolicy = try {
            NavigationPolicy(loaded.startUrl, loaded.allowedHosts, loaded.allowSubdomains)
        } catch (e: IllegalArgumentException) {
            return showFatal(getString(R.string.config_error))
        }
        config = loaded
        policy = navigationPolicy

        configureWebView(loaded)
        configureControls(loaded)

        // App-initiated loads do not go through shouldOverrideUrlLoading, so check the start URL here.
        val restored = savedInstanceState != null && webView.restoreState(savedInstanceState) != null
        if (!restored) loadUrlChecked(loaded.startUrl)
    }

    // On Android 15+ (targetSdk 35) the window is edge-to-edge; keep content clear of the system
    // bars and the keyboard. Older versions already lay out below the bars, so nothing to do there.
    private fun applySystemBarInsets(root: View) {
        if (Build.VERSION.SDK_INT < 35) return
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
            )
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
            WindowInsetsCompat.CONSUMED
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Suppress("DEPRECATION")
    private fun configureWebView(config: AppConfig) {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // No local file or content access, and never mix HTTP into HTTPS pages.
            allowFileAccess = false
            allowContentAccess = false
            setAllowFileAccessFromFileURLs(false)
            setAllowUniversalAccessFromFileURLs(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setGeolocationEnabled(false)
            // Multiple windows are enabled only so onCreateWindow can refuse every popup.
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = false
            if (Build.VERSION.SDK_INT >= 26) safeBrowsingEnabled = true
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, false)
        }
        webView.webViewClient = SiteClient()
        webView.webChromeClient = SiteChromeClient(config)
        // No addJavascriptInterface and no DownloadListener: no native bridge, no file downloads.
    }

    private fun configureControls(config: AppConfig) {
        refreshLayout.isEnabled = config.pullToRefresh
        if (config.pullToRefresh) {
            refreshLayout.setOnChildScrollUpCallback { _, _ -> webView.scrollY > 0 }
            refreshLayout.setOnRefreshListener { webView.reload() }
        }

        retryButton.setOnClickListener {
            val target = failedUrl?.takeIf { policy?.isAllowed(it) == true } ?: config.startUrl
            loadUrlChecked(target)
        }

        if (config.backNavigation) {
            onBackPressedDispatcher.addCallback(
                this,
                object : OnBackPressedCallback(true) {
                    override fun handleOnBackPressed() {
                        if (webView.canGoBack()) {
                            webView.goBack()
                        } else {
                            // Nothing left in history: fall back to the normal back behaviour (leave the app).
                            isEnabled = false
                            onBackPressedDispatcher.onBackPressed()
                        }
                    }
                },
            )
        }
    }

    private fun loadUrlChecked(url: String) {
        if (policy?.isAllowed(url) != true) {
            showFatal(getString(R.string.config_error))
            return
        }
        errorView.visibility = View.GONE
        webView.loadUrl(url)
    }

    private fun showFatal(message: String) {
        errorBody.text = message
        retryButton.visibility = View.GONE
        refreshLayout.visibility = View.GONE
        errorView.visibility = View.VISIBLE
    }

    private fun showLoadError(message: String) {
        errorBody.text = message
        retryButton.visibility = View.VISIBLE
        errorView.visibility = View.VISIBLE
    }

    private fun handleBlockedNavigation(url: String) {
        val opensInBrowser = config?.externalLinks == ExternalLinks.SYSTEM_BROWSER && isWebUrl(url)
        if (opensInBrowser) {
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE))
                return
            } catch (_: ActivityNotFoundException) {
                // Fall through to the blocked message.
            }
        }
        Toast.makeText(this, R.string.link_blocked, Toast.LENGTH_SHORT).show()
    }

    // Only plain web links may leave the app, and only when the owner opted in. Never intent:/file:/custom schemes.
    private fun isWebUrl(url: String): Boolean {
        val scheme = Uri.parse(url).scheme?.lowercase()
        return scheme == "https" || scheme == "http"
    }

    private inner class SiteClient : WebViewClient() {
        // Returns true to reject the navigation, false to let the WebView perform it. Never calls
        // loadUrl() from here: that would re-enter this callback.
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame) return false
            val url = request.url.toString()
            if (policy?.isAllowed(url) == true) return false
            handleBlockedNavigation(url)
            return true
        }

        // Extra layer: shouldOverrideUrlLoading is not called for POST navigations, but every
        // main-frame request (including POSTs and redirect hops) is visible here. Best effort only.
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            if (!request.isForMainFrame) return null
            if (policy?.isAllowed(request.url.toString()) == true) return null
            return WebResourceResponse(
                "text/html",
                "utf-8",
                403,
                "Blocked",
                mapOf("Cache-Control" to "no-store"),
                ByteArrayInputStream(BLOCKED_PAGE.toByteArray(Charsets.UTF_8)),
            )
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            currentLoadUrl = url
            loadFailed = false
        }

        override fun onPageFinished(view: WebView, url: String?) {
            refreshLayout.isRefreshing = false
            // The WebView also reports "finished" after an error page; keep our error screen then.
            if (!loadFailed) errorView.visibility = View.GONE
        }

        // Only a failed main-frame load replaces the page; a missing image or font must not.
        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            loadFailed = true
            failedUrl = request.url.toString()
            refreshLayout.isRefreshing = false
            if (config?.offlineScreen == true) showLoadError(getString(R.string.error_body))
        }

        // Certificate problems are never bypassed. HTTP error statuses are left to the site's own pages.
        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel()
            if (error.url != currentLoadUrl) return
            loadFailed = true
            failedUrl = error.url
            refreshLayout.isRefreshing = false
            if (config?.offlineScreen == true) showLoadError(getString(R.string.ssl_error_body))
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // The WebView is unusable now; rebuild the activity instead of crashing.
            skipStateSave = true
            recreate()
            return true
        }
    }

    private inner class SiteChromeClient(private val config: AppConfig) : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            if (!config.loadingIndicator) return
            progressBar.progress = newProgress
            progressBar.visibility = if (newProgress in 0..99) View.VISIBLE else View.GONE
        }

        // Fail closed: window.open() and target="_blank" never get a secondary WebView.
        override fun onCreateWindow(
            view: WebView,
            isDialog: Boolean,
            isUserGesture: Boolean,
            resultMsg: Message,
        ): Boolean = false
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (config != null && !skipStateSave) webView.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        webView.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onDestroy() {
        refreshLayout.removeAllViews()
        webView.stopLoading()
        webView.destroy()
        super.onDestroy()
    }

    private companion object {
        const val CONFIG_ASSET = "app-config.json"
        const val BLOCKED_PAGE =
            "<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
                "<body style=\"font-family:sans-serif;padding:2em;text-align:center\">" +
                "<h2>Link blocked</h2><p>This page is outside the website this app is limited to.</p></body>"
    }
}
