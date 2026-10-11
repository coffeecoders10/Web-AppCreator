# Website to Android App

A small, self-hosted web app that turns an existing **HTTPS website** into an installable **Android APK**.
Paste a URL, set a few options, click **Generate APK**, download the file. The app it produces shows your
live site in an Android WebView, limited to the hosts you allow.

Everything runs on your machine: a Next.js server, a local Gradle build and a folder of temporary files.
There is **no database, no cloud storage, no external API, no login and no hosted build service**.

> **Status:** v1, Android only. iOS is out of scope (the config format leaves room for it, see
> [Future work](#future-work)). The full specification is in [AppCreatorSpecV1.md](AppCreatorSpecV1.md).

## How it works

```
Browser form ──▶ POST /api/builds ──▶ validate (Zod) ──▶ in-memory queue (one build at a time)
                                                              │
                          copy templates/android ─▶ write assets/app-config.json, generator.properties,
                          app label and launcher icons ─▶ ./gradlew assembleDebug (child process)
                                                              │
Browser polls GET /api/builds/:id ◀── status, stage, safe log ┘ ──▶ GET /api/builds/:id/download (APK)
```

- **Generator:** Next.js App Router + TypeScript, Node runtime, CSS Modules (no Tailwind).
- **Template:** a plain Kotlin Android project in [templates/android](templates/android), independently buildable.
  The generator copies it per job, so nothing app-specific is committed to it.
- **Config contract:** one Zod-validated object ([src/lib/config.ts](src/lib/config.ts)) shared by the form, the
  build orchestrator and the app (`assets/app-config.json`, schema version 1, `platform: "android"`).
- **State:** job registry and queue live in the server process memory. Files live under one build folder.
  Restarting the server discards all jobs and wipes the folder.

## Requirements

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 20.9 or newer | Developed on Node 24. |
| JDK | **17** (17 to 21 accepted) | Tested with Eclipse Temurin 17. |
| Android SDK | platform `android-35`, build-tools `35.0.0`, licenses accepted | Command-line tools are enough. |
| Disk / RAM | ~3 GB free disk, 4 GB+ RAM | Gradle caches and the JVM. |

Pinned versions (also in [templates/android/toolchain.json](templates/android/toolchain.json)):

| Component | Version |
| --- | --- |
| Gradle (wrapper) | 8.14.6 |
| Android Gradle Plugin | 8.13.2 |
| Kotlin | 2.3.21 |
| compileSdk / targetSdk / minSdk | 35 / 35 / 24 (Android 7.0+) |
| Next.js / React / Zod | 16.4.0 / 19.3.0 / 4.6.5 |

The generator finds the JDK from `JAVA_HOME`, `PATH` or common install folders, and the SDK from
`ANDROID_HOME`, `ANDROID_SDK_ROOT` or the default location for your OS. You do not have to export variables if
the tools are in a standard place.

## Setup

### 1. Install the generator's dependencies

```bash
npm install
```

### 2. Install a JDK and the Android SDK

**Windows (PowerShell)**

```powershell
winget install --id EclipseAdoptium.Temurin.17.JDK -e
# Download "Command line tools only" from https://developer.android.com/studio#command-tools and unzip it to
#   %LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest
$sdk = "$env:LOCALAPPDATA\Android\Sdk"
& "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root="$sdk" "platform-tools" "platforms;android-35" "build-tools;35.0.0"
& "$sdk\cmdline-tools\latest\bin\sdkmanager.bat" --sdk_root="$sdk" --licenses   # answer y to each
```

**macOS / Linux**

```bash
# Install JDK 17 with your package manager (brew install --cask temurin@17 / apt install openjdk-17-jdk).
# Unzip the command-line tools to ~/Android/Sdk/cmdline-tools/latest (Linux) or ~/Library/Android/sdk/cmdline-tools/latest (macOS).
export ANDROID_HOME="$HOME/Android/Sdk"
"$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" "platform-tools" "platforms;android-35" "build-tools;35.0.0"
yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses
chmod +x templates/android/gradlew   # only if your checkout lost the executable bit
```

Installing Android Studio instead also works; it provides the same SDK and a JDK.

### 3. Verify the toolchain

```bash
npm run check-env        # lists every prerequisite and how to fix what is missing
npm run build:template   # builds templates/android on its own: unit tests + debug APK
```

`build:template` is optional but recommended: it downloads Gradle and the Android dependencies once, so the
first build from the web UI is fast (otherwise it can take several minutes).

### 4. Start the generator

```bash
npm run dev              # development
# or
npm run build && npm start
```

Open <http://127.0.0.1:3000> (set `PORT` to change it). The server **binds to 127.0.0.1 only**.

### 5. Generate and install

1. Enter an HTTPS URL. App name and application ID are suggested for you.
2. Click **Generate APK**, wait for the stages to finish, click **Download APK**.
3. Install it: `adb install -r reader-1.0.0-debug.apk`, or copy the file to a phone and open it
   (allow installs from your file manager or browser).

## Using the generator

- **Website URL** (required, HTTPS). The default navigation policy allows exactly the start host over HTTPS.
- **App name**, **Application ID** (like `com.example.reader`), optional **square PNG icon** (192 px or more,
  max 2 MB). Without an icon a letter-on-colour icon is drawn locally. Icons are scaled to every density and
  also produce an adaptive icon.
- **Advanced:** version name/code, extra allowed hosts, subdomain matching (off by default), what to do with
  other links (**Block** by default; opt-in **Open in the system browser** for plain http(s) links), back button,
  loading bar, offline/error screen with Retry, rotation (portrait by default), pull to refresh (off).

### Navigation rules (what the app allows)

With start URL `https://reader.example.com` and defaults:

| Destination | Result |
| --- | --- |
| `https://reader.example.com/books` | Opens in the app |
| `http://reader.example.com` | Blocked (not HTTPS) |
| `https://example.com` | Blocked (different host) |
| `https://api.reader.example.com` | Blocked unless allow-listed or subdomains are on |
| `https://reader.example.com.attacker.test` | Blocked |
| `https://attacker.test/?next=reader.example.com` | Blocked |
| `https://reader.example.com@attacker.test/` | Blocked (credentials in URL) |
| `intent:`, `file:`, `content:`, `javascript:`, custom schemes | Blocked |
| `window.open()` / `target="_blank"` | Suppressed |

Hosts are parsed and compared as normalized names (lower-case, punycode, no trailing dot), never by string
prefix. A non-default port is allowed only if it is the start URL's port. The rules are implemented twice,
in [NavigationPolicy.kt](templates/android/app/src/main/kotlin/com/websitetoapp/shell/NavigationPolicy.kt) (authoritative) and
[navigation-policy.ts](src/lib/navigation-policy.ts), and both are tested against the same
[navigation-vectors.json](templates/android/app/src/test/resources/navigation-vectors.json).

## Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port. |
| `BUILD_ROOT` | `<os tmp>/website-to-app-builds` | Where workspaces and APKs live. Wiped at startup; refused if it already holds files this tool did not create. |
| `MAX_QUEUED_BUILDS` | `3` | Builds allowed to wait behind the running one; more get HTTP 429. |
| `JOB_TTL_MINUTES` | `60` | How long a finished job and its APK are kept. |
| `BUILD_TIMEOUT_MINUTES` | `20` | A build running longer is killed. |
| `GRADLE_OFFLINE` | unset | `1` adds `--offline` (use cached dependencies only). |
| `GRADLE_DAEMON` | unset | `1` keeps the Gradle daemon (faster repeat builds, but holds file locks on Windows). |

## API (internal, not an external service)

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/environment` | GET | Whether JDK, SDK and template look usable. Contains no file paths. |
| `/api/builds` | POST | Multipart: `config` (JSON string) and optional `icon` (PNG). Returns `202 {id}`; 422 with per-field errors; 429 queue full; 503 environment not ready. |
| `/api/builds/:id` | GET | `queued` / `building` / `completed` / `failed`, stage, progress, safe log tail, artifact info. |
| `/api/builds/:id/download` | GET | Streams the APK of a completed job. |

## Security notes

- **Trusted machine only.** There is no login. Keep the server on localhost. If you expose it on a network you
  must add authentication, rate limiting and TLS first; job IDs (128-bit random) are not an access control.
- `POST /api/builds` rejects cross-origin browser requests, so a random web page cannot start builds on your machine.
- User input never reaches a shell: values go into validated JSON, a properties file and escaped resource XML.
  The Gradle command line contains only constants.
- Build logs are shown with local paths replaced (`<workspace>`, `<android-sdk>`, `~`). The generated APK
  contains only the validated config, no server paths or secrets.
- The APK requests only the `INTERNET` permission, forbids cleartext HTTP, never proceeds through certificate
  errors, exposes no JavaScript bridge, and disables file/content access.
  (AndroidX adds an internal signature-level `<package>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`; it grants nothing.)

## Known limitations

This is a **practical restricted-navigation wrapper for a website you own or trust, not a hardened sandbox.**

- Android's `shouldOverrideUrlLoading` is **not called for POST navigations**. The app adds a best-effort check of
  every main-frame request in `shouldInterceptRequest` (it shows a "Link blocked" page for off-policy requests,
  including POSTs and redirect hops), but there is no guarantee that every conceivable navigation path is covered.
  Subresources (scripts, images, API calls, iframes) are deliberately **not** filtered.
- `target="_blank"` and `window.open()` are ignored (fail-closed), even for same-host links.
- **OAuth / social login** often refuses embedded WebViews, or needs a temporary trip to another domain.
  Allow-listing an identity provider widens what can open in the app. Such flows are not supported or special-cased.
- Not included in v1: file uploads and downloads, camera/microphone/location, notifications, JavaScript
  `alert`/`confirm` dialogs (a plain `WebChromeClient` ignores them), splash screens, custom user agent.
- Third-party cookies are off. Sites that depend on them inside the WebView may not work.
- APKs are **debug-signed** (the standard local Android debug key): fine for testing and sideloading, **not** for the
  Play Store. Different machines have different debug keys, so an APK built on one machine cannot be installed over
  one built on another without uninstalling first.
- Closing the generator with a hard kill can leave a Gradle process running for a while. Ctrl+C / SIGTERM are handled and should stop it (not tested on every platform).

## Testing

```bash
npm test                 # Vitest: navigation policy, config validation, build helpers (115 tests)
npm run typecheck
npm run build:template   # Gradle: Kotlin unit tests (policy + config parsing) and the template APK
```

The Kotlin and TypeScript navigation policies run the same case list. Add a case to
`navigation-vectors.json` and both suites pick it up.

### Navigation fixture and on-device checklist

[tests/fixtures/navigation-site](tests/fixtures/navigation-site) is a tiny page with every case from the spec: same
host, other host, lookalike host, HTTP, redirect (cross-host and same-host), `target=_blank`, `window.open`, JS
navigation, SPA `pushState`, form POST (same host and other host), non-web schemes and an iframe. Each item states its expected result.

```bash
npm run fixture          # serves it on http://127.0.0.1:8080 with the /redirect-* and /echo routes it needs
```

Generated apps load HTTPS only, so to try the fixture on a device either put the server behind an HTTPS tunnel
or copy the two HTML files to any HTTPS static host, then generate an app with that URL.

Verified in development: unit tests (TypeScript and Kotlin), the full generator flow (API and browser UI), real
debug-signed APKs with the right label, application ID, version, orientation, config asset, icons and only the
`INTERNET` permission, queueing, 429 limits, expiry and restart cleanup. **Not yet exercised on an emulator or
device** in this repository's initial implementation: run the fixture checklist above before relying on the
runtime behaviour (back button, Retry screen, popups, redirects, POST handling).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| UI banner "This machine can't build Android apps yet" | Run `npm run check-env`; each failing line includes the fix. |
| `You have not accepted the license agreements` | `sdkmanager --licenses` |
| `SDK location not found` | Set `ANDROID_HOME` and restart the generator. |
| `Could not resolve ...` / `UnknownHostException` | The first build needs internet for Gradle and Android dependencies. Check proxy/network. After one successful build, `GRADLE_OFFLINE=1` works. |
| `Unsupported class file major version` | Use JDK 17 (17-21). |
| Build times out on first run | Run `npm run build:template` once, or raise `BUILD_TIMEOUT_MINUTES`. |
| `BUILD_ROOT already contains files...` | Point `BUILD_ROOT` at an empty or dedicated folder. |
| Port 3000 already in use | `PORT=3417 npm run dev` |
| Download says "not found" | The job expired (1 hour by default) or the generator was restarted. Build again. |
| `adb: INSTALL_FAILED_UPDATE_INCOMPATIBLE` | An APK signed with a different debug key is installed: `adb uninstall <application id>` first. |

## Project layout

```
src/app/                 page and the four API route handlers
src/components/          generator-form/, build-status/, GeneratorApp
src/lib/                 config.ts, navigation-policy.ts, build-manager.ts, android-builder.ts,
                         environment.ts, icon.ts, file-utils.ts (+ small helpers)
src/instrumentation.ts   startup cleanup of the build folder
templates/android/       Kotlin WebView project + Gradle wrapper + toolchain.json
scripts/                 check-environment, build-template, serve-fixture
tests/                   Vitest suites and the navigation fixture
```

## Future work

- **Release signing:** accept a developer-supplied persistent keystore and run `assembleRelease`. Keys must be
  kept stable across updates; never generated silently or discarded.
- **iOS:** a separate Swift/WKWebView template and a macOS/Xcode builder next to `android-builder.ts`. The config's
  `platform` and `schemaVersion` fields and the artifact-as-metadata model are the intended extension points.
- File uploads/downloads, camera/location, notifications, authentication helpers, splash screens.
