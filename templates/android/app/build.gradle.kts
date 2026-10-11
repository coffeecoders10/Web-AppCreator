import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Per-build values (application ID, version, orientation) are written by the generator to
// generator.properties in the workspace root. The defaults below keep this template buildable
// on its own for troubleshooting. The website URL, name and navigation rules are NOT here:
// they live in src/main/assets/app-config.json.
val generated = Properties().apply {
    val file = rootProject.file("generator.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

fun generated(key: String, default: String): String = generated.getProperty(key, default)

android {
    namespace = "com.websitetoapp.shell"
    compileSdk = 35

    defaultConfig {
        applicationId = generated("applicationId", "com.example.websiteapp")
        minSdk = 24
        targetSdk = 35
        versionCode = generated("versionCode", "1").toInt()
        versionName = generated("versionName", "1.0.0")
        manifestPlaceholders["screenOrientation"] = generated("screenOrientation", "portrait")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")

    testImplementation("junit:junit:4.13.2")
    // The Android stub of org.json throws in JVM unit tests; use the real implementation there.
    testImplementation("org.json:json:20250517")
}
