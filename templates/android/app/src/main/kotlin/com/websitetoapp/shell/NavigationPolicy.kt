package com.websitetoapp.shell

import java.net.IDN
import java.net.URI
import java.net.URISyntaxException
import java.util.Locale

enum class NavigationReason(val id: String) {
    ALLOWED("allowed"),
    INVALID_URL("invalid-url"),
    UNSUPPORTED_SCHEME("unsupported-scheme"),
    NOT_HTTPS("not-https"),
    CREDENTIALS_IN_URL("credentials-in-url"),
    PORT_NOT_ALLOWED("port-not-allowed"),
    HOST_NOT_ALLOWED("host-not-allowed"),
}

/**
 * Decides whether a top-level page navigation may happen inside the WebView.
 *
 * Pure Kotlin (no Android classes) so it runs in plain JVM unit tests. The TypeScript twin in the
 * generator (src/lib/navigation-policy.ts) is checked against the same vectors.
 *
 * Rules: parse the URL properly and compare normalized host names (never string prefixes);
 * HTTPS only; exact host unless subdomains are enabled, then a dot-delimited suffix; no
 * credentials in the URL; the port must be the default (443) or the start URL's port. Anything
 * odd (whitespace, backslashes, unparseable input) is rejected rather than "fixed up".
 */
class NavigationPolicy(
    startUrl: String,
    allowedHosts: List<String>,
    private val allowSubdomains: Boolean,
) {
    private val startPort: Int
    private val allowedHosts: List<String>

    init {
        val start = parseHttpsUri(startUrl)
            ?: throw IllegalArgumentException("The start URL must be a valid HTTPS URL.")
        startPort = effectivePort(start)
        this.allowedHosts = allowedHosts.mapNotNull { normalizeHost(it) }.distinct()
        require(this.allowedHosts.isNotEmpty()) { "At least one valid allowed host is required." }
    }

    fun evaluate(url: String): NavigationReason {
        if (UNSAFE_CHARS.containsMatchIn(url)) return NavigationReason.INVALID_URL

        // Check the scheme textually first: many non-web URIs (data:, intent:) are not valid
        // hierarchical URIs, but they must be reported as an unsupported scheme, not as garbage.
        val scheme = SCHEME.find(url)?.groupValues?.get(1)?.lowercase(Locale.ROOT)
            ?: return NavigationReason.INVALID_URL
        if (scheme == "http") return NavigationReason.NOT_HTTPS
        if (scheme != "https") return NavigationReason.UNSUPPORTED_SCHEME

        val uri = try {
            URI(url)
        } catch (_: URISyntaxException) {
            return NavigationReason.INVALID_URL
        }
        // Any "@" in the authority means user info; "https://trusted.example@evil.test" is the classic trick.
        if (uri.rawAuthority?.contains('@') == true) return NavigationReason.CREDENTIALS_IN_URL

        val port = effectivePort(uri)
        if (port != -1 && port != startPort) return NavigationReason.PORT_NOT_ALLOWED

        val host = uri.host?.let { normalizeHost(it) } ?: return NavigationReason.INVALID_URL
        return if (isHostAllowed(host)) NavigationReason.ALLOWED else NavigationReason.HOST_NOT_ALLOWED
    }

    fun isAllowed(url: String): Boolean = evaluate(url) == NavigationReason.ALLOWED

    private fun isHostAllowed(host: String): Boolean =
        allowedHosts.any { allowed ->
            host == allowed ||
                // "child.example.com" matches "example.com"; "fakeexample.com" does not.
                (allowSubdomains && !IPV4.matches(allowed) && host.endsWith(".$allowed"))
        }

    companion object {
        private val UNSAFE_CHARS = Regex("[\\u0000-\\u0020\\u007f-\\u009f\\\\]")
        private val SCHEME = Regex("^([A-Za-z][A-Za-z0-9+.-]*):")
        private val LABEL = Regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")
        private val IPV4 = Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")

        /** Lower-case, punycode, no trailing dot. Null if this is not a plain DNS name or IPv4 address. */
        fun normalizeHost(raw: String): String? {
            val trimmed = raw.trim()
            if (trimmed.isEmpty() || UNSAFE_CHARS.containsMatchIn(trimmed)) return null
            if (trimmed.any { it in "/?#@:[]" }) return null
            val ascii = try {
                IDN.toASCII(trimmed, IDN.ALLOW_UNASSIGNED)
            } catch (_: IllegalArgumentException) {
                return null
            }
            val host = ascii.lowercase(Locale.ROOT).removeSuffix(".")
            if (host.isEmpty() || host.length > 253) return null
            if (IPV4.matches(host)) return if (host.split('.').all { it.toInt() <= 255 }) host else null
            return if (host.split('.').all { LABEL.matches(it) }) host else null
        }

        private fun parseHttpsUri(url: String): URI? {
            if (UNSAFE_CHARS.containsMatchIn(url)) return null
            val uri = try {
                URI(url)
            } catch (_: URISyntaxException) {
                return null
            }
            if (uri.scheme?.lowercase(Locale.ROOT) != "https") return null
            if (uri.rawAuthority?.contains('@') == true) return null
            return if (uri.host?.let { normalizeHost(it) } != null) uri else null
        }

        /** -1 means "default HTTPS port" (an explicit :443 is the same thing). */
        private fun effectivePort(uri: URI): Int = if (uri.port == 443) -1 else uri.port
    }
}
