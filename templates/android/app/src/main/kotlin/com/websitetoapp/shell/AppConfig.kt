package com.websitetoapp.shell

import org.json.JSONException
import org.json.JSONObject

class ConfigException(message: String) : Exception(message)

enum class ExternalLinks { BLOCK, SYSTEM_BROWSER }

enum class Orientation { PORTRAIT, AUTO }

/**
 * Runtime configuration, read from assets/app-config.json at launch. The generator validates the
 * same contract (schemaVersion 1, platform "android") with Zod; this is the on-device check, so a
 * hand-edited or corrupt asset fails closed instead of loading something unexpected.
 */
data class AppConfig(
    val startUrl: String,
    val allowedHosts: List<String>,
    val allowSubdomains: Boolean,
    val externalLinks: ExternalLinks,
    val orientation: Orientation,
    val backNavigation: Boolean,
    val loadingIndicator: Boolean,
    val offlineScreen: Boolean,
    val pullToRefresh: Boolean,
) {
    companion object {
        private const val SCHEMA_VERSION = 1

        fun parse(json: String): AppConfig {
            try {
                val root = JSONObject(json)
                if (root.optInt("schemaVersion", -1) != SCHEMA_VERSION) {
                    throw ConfigException("Unsupported config schema version.")
                }
                if (root.optString("platform") != "android") {
                    throw ConfigException("Config is not for Android.")
                }
                val app = root.optJSONObject("app") ?: throw ConfigException("Missing \"app\" section.")
                val navigation = root.optJSONObject("navigation") ?: throw ConfigException("Missing \"navigation\" section.")
                val appearance = root.optJSONObject("appearance") ?: JSONObject()
                val features = root.optJSONObject("features") ?: JSONObject()

                val hostsJson = navigation.optJSONArray("allowedHosts")
                    ?: throw ConfigException("Missing \"allowedHosts\".")
                val hosts = (0 until hostsJson.length()).map { hostsJson.getString(it) }

                return AppConfig(
                    startUrl = app.getString("startUrl"),
                    allowedHosts = hosts,
                    allowSubdomains = navigation.optBoolean("allowSubdomains", false),
                    externalLinks = when (navigation.optString("externalLinks", "block")) {
                        "block" -> ExternalLinks.BLOCK
                        "system-browser" -> ExternalLinks.SYSTEM_BROWSER
                        else -> throw ConfigException("Unknown externalLinks value.")
                    },
                    orientation = when (appearance.optString("orientation", "portrait")) {
                        "portrait" -> Orientation.PORTRAIT
                        "auto" -> Orientation.AUTO
                        else -> throw ConfigException("Unknown orientation value.")
                    },
                    backNavigation = features.optBoolean("backNavigation", true),
                    loadingIndicator = features.optBoolean("loadingIndicator", true),
                    offlineScreen = features.optBoolean("offlineScreen", true),
                    pullToRefresh = features.optBoolean("pullToRefresh", false),
                )
            } catch (e: JSONException) {
                throw ConfigException("The app configuration is not valid JSON: ${e.message}")
            }
        }
    }
}
