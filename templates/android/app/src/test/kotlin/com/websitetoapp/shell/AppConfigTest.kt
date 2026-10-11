package com.websitetoapp.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppConfigTest {
    private fun json(
        startUrl: String = "https://reader.example.com/",
        extra: String = "",
        schemaVersion: Int = 1,
        platform: String = "android",
    ) = """
        {
          "schemaVersion": $schemaVersion,
          "platform": "$platform",
          "app": { "name": "Reader", "applicationId": "com.example.reader", "versionName": "1.0.0", "versionCode": 1, "startUrl": "$startUrl" },
          "navigation": { "allowedHosts": ["reader.example.com"], "allowSubdomains": false, "externalLinks": "block" $extra },
          "appearance": { "orientation": "portrait" },
          "features": { "backNavigation": true, "loadingIndicator": true, "offlineScreen": true, "pullToRefresh": false }
        }
    """.trimIndent()

    @Test
    fun parsesValidConfig() {
        val config = AppConfig.parse(json())
        assertEquals("https://reader.example.com/", config.startUrl)
        assertEquals(listOf("reader.example.com"), config.allowedHosts)
        assertEquals(ExternalLinks.BLOCK, config.externalLinks)
        assertEquals(Orientation.PORTRAIT, config.orientation)
        assertTrue(config.backNavigation)
        assertFalse(config.pullToRefresh)
    }

    @Test(expected = ConfigException::class)
    fun rejectsOtherSchemaVersions() {
        AppConfig.parse(json(schemaVersion = 2))
    }

    @Test(expected = ConfigException::class)
    fun rejectsOtherPlatforms() {
        AppConfig.parse(json(platform = "ios"))
    }

    @Test(expected = ConfigException::class)
    fun rejectsGarbage() {
        AppConfig.parse("not json")
    }

    @Test(expected = ConfigException::class)
    fun rejectsUnknownExternalLinksValue() {
        AppConfig.parse(json().replace("\"block\"", "\"anything\""))
    }
}
