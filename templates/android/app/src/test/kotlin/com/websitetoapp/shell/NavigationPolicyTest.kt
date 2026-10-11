package com.websitetoapp.shell

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class NavigationPolicyTest {
    /** Runs every case of navigation-vectors.json, the same file the generator's Vitest suite uses. */
    @Test
    fun sharedVectors() {
        val resource = javaClass.classLoader!!.getResource("navigation-vectors.json")
        assertNotNull("navigation-vectors.json must be on the test classpath", resource)
        val suites = JSONObject(resource!!.readText(Charsets.UTF_8)).getJSONArray("suites")

        val failures = mutableListOf<String>()
        var checked = 0
        for (i in 0 until suites.length()) {
            val suite = suites.getJSONObject(i)
            val rules = suite.getJSONObject("rules")
            val hostsJson = rules.getJSONArray("allowedHosts")
            val policy = NavigationPolicy(
                startUrl = rules.getString("startUrl"),
                allowedHosts = (0 until hostsJson.length()).map { hostsJson.getString(it) },
                allowSubdomains = rules.getBoolean("allowSubdomains"),
            )
            val cases = suite.getJSONArray("cases")
            for (j in 0 until cases.length()) {
                val case = cases.getJSONObject(j)
                val url = case.getString("url")
                val expected = case.getString("reason")
                val actual = policy.evaluate(url).id
                checked++
                if (actual != expected) {
                    failures += "[${suite.getString("name")}] $url -> expected $expected but was $actual"
                }
            }
        }
        assertTrue("No vectors were checked", checked > 0)
        if (failures.isNotEmpty()) fail(failures.joinToString("\n"))
    }

    @Test
    fun hostNormalization() {
        assertEquals("reader.example.com", NavigationPolicy.normalizeHost("Reader.Example.COM."))
        assertEquals("xn--bcher-kva.example", NavigationPolicy.normalizeHost("bücher.example"))
        assertEquals("192.168.1.10", NavigationPolicy.normalizeHost("192.168.1.10"))
        assertNull(NavigationPolicy.normalizeHost(""))
        assertNull(NavigationPolicy.normalizeHost("https://example.com"))
        assertNull(NavigationPolicy.normalizeHost("example.com/path"))
        assertNull(NavigationPolicy.normalizeHost("example.com:8443"))
        assertNull(NavigationPolicy.normalizeHost("user@example.com"))
        assertNull(NavigationPolicy.normalizeHost("exa mple.com"))
        assertNull(NavigationPolicy.normalizeHost("999.1.1.1"))
        assertNull(NavigationPolicy.normalizeHost("-bad-.example.com"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsNonHttpsStartUrl() {
        NavigationPolicy("http://example.com", listOf("example.com"), false)
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsEmptyHostList() {
        NavigationPolicy("https://example.com", emptyList(), false)
    }
}
