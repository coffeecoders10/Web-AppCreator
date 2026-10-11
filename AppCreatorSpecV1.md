# Website-to-Android App Generator

**Status:** Implementation specification  
**Current target:** Android only  
**Future target:** iOS (explicitly out of scope for v1)

## 1. Goal

Build a small, self-hosted web application that turns an existing HTTPS website into a downloadable, installable **Android APK**. A user should be able to paste a URL, set a few app details and navigation rules, click **Generate APK**, and download an app that displays that website inside an Android WebView.

The generated app should feel like a simple dedicated mobile app, not a general-purpose browser. It must keep ordinary navigation within configured website boundaries and reject unapproved destinations.

**The generator must function as one standalone project.** It must not depend on a database, object-storage service, hosted build API, authentication provider, third-party metadata API, or any other external service the developer would need to create or configure.

The existing website itself is still hosted at the URL entered by the user: this tool **wraps** that live website; it does not bundle or mirror it. The device normally needs internet access to load the website.

## 2. Non-negotiable constraints

1. **Android only in v1.** Produce APKs; do not implement iOS, IPA generation, TestFlight, or App Store integrations now.
2. **No external infrastructure:** no Postgres, SQLite, Prisma, Firebase, Supabase, Redis, S3, cloud storage, cloud functions, CI build service, external conversion API, or hosted worker.
3. **No application database:** keep active job state in memory and temporary build files on the generator machine's local filesystem. Clear them after expiration and on restart.
4. **No custom external APIs:** the Next.js route handlers belong to this project and run locally. Do not require the user to develop, register, or deploy another backend/API.
5. **No login or accounts** for v1. Intended deployment is local or a trusted private machine/network. Do not expose an unauthenticated build endpoint to the public internet.
6. **No serverless assumption:** Android builds require a persistent Node.js process, a writable local filesystem, and installed build tools. The app should run with a regular self-hosted Next.js Node server.
7. **Simple over clever:** prefer a stable native template and a small build orchestrator over dynamically generating an Android project from scratch.
8. **No Tailwind CSS.** Use CSS Modules or ordinary CSS. Use existing Radix UI primitives if available; do not force an additional UI framework.
9. **Actual APK output is required.** A mocked build, sample APK, or ZIP of source code is not completion.
10. **Keep the code maintainable:** TypeScript for the generator, Kotlin for the Android template, a typed configuration schema, and clear module boundaries without excessive abstraction.

### What external access is and is not required

| Item | Required? | Notes |
| --- | --- | --- |
| External database/API/storage service | **No** | Never needed for core functionality. |
| Remote compilation/build provider | **No** | Gradle and Android SDK build locally. |
| Local temporary disk space | **Yes** | Needed for build workspaces and downloaded APKs; this is **not** external storage. |
| Java JDK, Android SDK, Gradle wrapper | **Yes** | Local developer/build-machine dependencies. Gradle wrapper and versioned template live in the repository. |
| Internet during initial tool/dependency installation | Usually | NPM, Android SDK components, and Gradle dependencies may need to be downloaded once; cached/offline builds may work afterward. |
| Internet on the generated Android app | Usually | Needed to load the user's live website. |
| Third-party website metadata service | **No** | Do not implement one. |

## 3. Technical approach

### Generator (web application)

- **Next.js App Router + TypeScript**, running in the Node.js runtime.
- **Single-page dark UI** for entering details and downloading the result.
- **Next.js route handlers** for local configuration validation, starting builds, reading build status, and downloading results.
- **One lightweight in-process build queue**; execute Gradle with Node.js `child_process.spawn`, not inside the synchronous HTTP request.
- **Local temporary directory per job**; use `os.tmpdir()` or a configurable local build folder. Never require mounted cloud storage.
- **No persistent job history.** If the generator process restarts, in-flight jobs are lost and unfinished work directories may be cleaned. Make this clear in the UI.

### Generated Android application

- Minimal, reusable **Kotlin Android project**.
- Android **WebView** as the main app screen.
- Native `WebViewClient` for navigations and errors; `WebChromeClient` only for needed progress behavior.
- Bundled JSON configuration read from application assets at launch.
- No calls to the generator after installation; the APK must function independently of the generator server.
- Use the website's existing HTML/CSS/JavaScript, assets, and backend. Do not copy the site's code into the APK.

### Why not Capacitor/React Native?

This v1 only needs a WebView, navigation rules, and minimal native UI. A direct Kotlin wrapper is smaller, easier to build automatically, and provides direct control over Android WebView behavior.

## 4. User experience and UI

Create one responsive, polished, dark-themed screen. Keep essential settings visible and optional settings inside an **Advanced** section. The happy path should take only a few inputs.

### Section A - Website

- **Website URL**: required, HTTPS URL, for example `https://reader.example.com`.
- Show the parsed host and a human-readable explanation of the default allowed-domain policy.
- Suggest an app name from the hostname if none was provided.
- Do **not** require a server-side fetch to scrape metadata or screenshots. URL entry must work even when a website blocks automated requests.

### Section B - App details

- **App name**: required; default inferred from host, editable.
- **Application ID**: required, e.g. `com.example.reader`; suggest a valid value; validate before building.
- **App icon**: optional upload; accept PNG and generate Android density assets locally. If absent, use a clean bundled generic icon with an initial/monogram.
- **Version name**: default `1.0.0`.
- **Version code**: default `1` (positive integer).

### Section C - Navigation rules

- Starting URL is the first page opened in the WebView.
- Default permitted navigation: **the exact starting host, over HTTPS**.
- Optional: user can add explicitly allowed hosts.
- Optional: user can allow subdomains of a host; **off by default**.
- External navigation policy: **Block** by default. The UI may offer **Open in system browser** as an explicit opt-in; no automatic browser handoff.
- Do not create a general-purpose URL bar in the generated app.

Example: with starting URL `https://reader.example.com` and defaults:

| Destination | Expected result |
| --- | --- |
| `https://reader.example.com/books` | Allow in WebView |
| `https://reader.example.com/profile` | Allow in WebView |
| `http://reader.example.com` | Block (non-HTTPS) |
| `https://example.com` | Block (different host) |
| `https://api.reader.example.com` as top-level navigation | Block unless allowlisted |
| `https://reader.example.com.attacker.test` | Block |
| `https://attacker.test/?next=reader.example.com` | Block |

### Section D - Basic behavior

- **Back navigation**: on by default; Android back button goes back in WebView history when possible, otherwise uses normal app exit behavior.
- **Loading indicator**: on by default.
- **Offline / error screen**: on by default; friendly text and **Retry** button.
- **Portrait orientation**: default; optionally allow auto-rotation.
- **Pull to refresh**: optional and off by default to keep the first version simple.

Do not add camera, geolocation, notifications, file uploads, file downloads, OAuth helpers, splash-screen editors, or dozens of native toggles in v1. Document them as later enhancements, not hidden requirements.

### Section E - Build and download

- Prominent **Generate APK** button.
- Display build stage, progress/status text, build failures, and useful but safe logs.
- On success: **Download APK** with a clear file name (e.g. `reader-1.0.0-debug.apk`).
- Explain that the first build may be slower while local Android build dependencies are resolved.
- Show a brief notice that a debug-signed APK is intended for sideloading/testing, not Play Store publication.

## 5. Configuration contract

Use one typed, validated object for the web form, build orchestrator, and generated Android assets. Prefer a straightforward JSON schema (e.g. Zod on the TypeScript side); implement corresponding Kotlin parsing/validation where necessary.

Example:

```json
{
  "schemaVersion": 1,
  "platform": "android",
  "app": {
    "name": "My Reader",
    "applicationId": "com.example.myreader",
    "versionName": "1.0.0",
    "versionCode": 1,
    "startUrl": "https://reader.example.com"
  },
  "navigation": {
    "allowedHosts": ["reader.example.com"],
    "allowSubdomains": false,
    "externalLinks": "block"
  },
  "appearance": {
    "orientation": "portrait"
  },
  "features": {
    "backNavigation": true,
    "loadingIndicator": true,
    "offlineScreen": true,
    "pullToRefresh": false
  }
}
```

Rules:

- Validate all values before initiating a build.
- Store no app-specific URL/name values hardcoded in the committed Kotlin template.
- Include the final JSON in the APK assets; it must not contain build-server paths, API keys, credentials, or signing secrets.
- The `platform` and `schemaVersion` fields provide a clear expansion point for a future iOS template without writing iOS support now.
- Icon data should be a validated upload supplied alongside config, **not** embedded as base64 JSON.

## 6. Navigation implementation (critical)

Treat URL restrictions as a native top-level navigation policy, not as a mechanism for blocking all network requests.

### Policy rules

1. Parse URLs properly and compare **normalized hostnames**, never `startsWith` string prefixes.
2. Accept only HTTPS for top-level web pages.
3. Match exact hostnames by default.
4. For explicitly enabled subdomains, require a dot-delimited suffix: `child.example.com` matches `example.com`, but `fakeexample.com` does not.
5. Reject unsupported URL schemes (`intent:`, `file:`, `content:`, `javascript:`, custom schemes) for navigation unless a narrowly scoped, explicitly implemented rule exists.
6. Apply checks to normal links, JavaScript navigations, and redirects where Android WebView exposes them.
7. Suppress new windows/popups (`window.open`, `target=_blank`) in v1 rather than allowing untracked secondary WebViews.
8. Never call `loadUrl()` with the same URL from inside `shouldOverrideUrlLoading`; return `false` to allow and `true` to reject.
9. Only apply *page-navigation* policy to main-frame navigation. Do **not** block ordinary third-party scripts, images, stylesheets, fonts, and API requests needed by the allowed website.
10. Check the configured start URL before invoking the app's initial `loadUrl()`; Android's override callback does not cover app-initiated loads.

### Required Android integration

- Set a `WebViewClient` and implement `shouldOverrideUrlLoading(WebView, WebResourceRequest)` for applicable navigations.
- Use `request.isForMainFrame` to distinguish page transitions from subresource requests.
- Use `WebChromeClient` only for progress/status behavior; do not silently accept new windows.
- Choose and test a fail-closed popup policy; new windows must not create a bypass path.
- Use `onReceivedError`/`onReceivedHttpError` appropriately for useful error UI (avoid replacing the page for an incidental failed image request).
- Preserve regular WebView history and cookies/session behavior.

**Important WebView limitation:** Android documents that `shouldOverrideUrlLoading` is **not invoked for POST requests**, and no single callback covers every conceivable navigation path. Therefore, **do not claim the result is a hardened network sandbox or that arbitrary untrusted websites can never initiate an off-domain request**. V1 is a practical restricted-navigation wrapper for a website the user owns/trusts. Test form submissions and redirects explicitly; if an app requires a strict security boundary for all POST navigations or network traffic, that is outside v1 and needs a different, carefully designed enforcement approach.

**Authentication caveat:** OAuth providers may block embedded WebViews or require temporary navigation to another domain. An allowed external auth host may also broaden the pages available inside the app. Document unsupported login flows rather than bypassing restrictions automatically.

## 7. Android WebView defaults and security

- Request the `INTERNET` permission only; do not add camera, microphone, storage, location, notification, or other dangerous permissions in v1.
- Enable JavaScript and DOM storage because most modern websites need them.
- Preserve cookies in the app's WebView data store; default to conservative third-party cookie behavior.
- Disable arbitrary local file/content URL access and universal file access from file URLs.
- Disable cleartext HTTP traffic and mixed-content loading.
- Do not ignore SSL errors or automatically proceed through certificate warnings.
- Do not expose `addJavascriptInterface` or unrestricted native bridges.
- Keep Android Safe Browsing protections enabled where available.
- Do not enable unrestricted intent handling or external-app launches.
- Handle the Android lifecycle reasonably (back navigation, rotation if enabled, cleanup/destroy WebView).
- Let the website handle its own routes, responsive layout, cookies, and backend functionality.

## 8. APK build pipeline

### Native Android template

Commit a known-working Gradle/Kotlin Android project under `templates/android/`, including the Gradle wrapper. Keep it independently buildable for troubleshooting.

At build time:

1. Validate the JSON configuration and uploaded icon.
2. Allocate an unpredictable job ID and a unique local temporary directory.
3. Copy the native Android template into that directory.
4. Write the config JSON into Android application assets.
5. Set app label, application ID, version name/code, orientation, and launcher icons.
6. Execute the **checked-in Gradle wrapper** (`gradlew` on Unix/macOS, `gradlew.bat` on Windows) with a debug APK task such as `assembleDebug`.
7. Capture exit code, bounded logs, and elapsed build stages.
8. Verify an actual, non-empty APK exists at the expected output path.
9. Copy or move the APK to that job's local downloadable artifact location.
10. Mark the job completed and expose a download endpoint.
11. Clean the job directory and artifacts after an expiry interval (suggested: 60 minutes), including on process restart.

**Signing for v1:** A Gradle `assembleDebug` APK is automatically signed with the local Android debug key and can be installed for testing. Do not claim it is a release-signed or Play Store-ready build. A future enhancement can support a developer-supplied persistent release keystore and `assembleRelease`; maintaining signing keys across updates is essential. Never silently invent or discard release keys.

### Build process constraints

- Default to **one build at a time** using an in-memory queue.
- Limit queued requests, build runtime, upload size, and captured log size.
- Use `spawn` with an argument array; never interpolate user input into a shell command.
- Do not run the Gradle build inside the request/response lifecycle or block the Node event loop.
- Keep the queue and job registry in the persistent Node process. A process restart cancels builds and clears in-memory status.
- Store local files only under a fixed, application-controlled build root; prevent path traversal.
- Show missing JDK / Android SDK configuration as an actionable preflight error.
- Build workers can be local child processes; **do not** introduce Redis, BullMQ, Docker, hosted queues, or a standalone build service.

## 9. Built-in API routes

These are **internal project endpoints**, not external services:

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/environment` | `GET` | Report whether local Java, Android SDK, and template prerequisites appear available. Do not expose sensitive local paths publicly. |
| `/api/builds` | `POST` | Validate multipart config/icon input, enqueue one Android build, return job ID. |
| `/api/builds/[id]` | `GET` | Return state: `queued`, `building`, `completed`, or `failed`, plus stage and safe error/log information. |
| `/api/builds/[id]/download` | `GET` | Stream an APK only when completed; set safe content type and attachment filename. |

The frontend may poll job status every 1-2 seconds. WebSockets, streaming events, persistence, and background infrastructure are unnecessary for the MVP.

Because v1 has no user accounts, **bind the app to localhost by default**. If exposing the generator on a network, add authentication, request-size/rate restrictions, and transport security before treating it as a deployable shared service. Do not rely on unguessable job IDs as the only authorization mechanism for a public deployment.

## 10. Suggested repository layout

```text
website-to-app/
  src/
    app/
      page.tsx
      api/
        environment/route.ts
        builds/route.ts
        builds/[id]/route.ts
        builds/[id]/download/route.ts
    components/
      generator-form/
      build-status/
    lib/
      config.ts
      build-manager.ts
      android-builder.ts
      file-utils.ts
    styles/
  templates/
    android/
      gradlew
      gradlew.bat
      gradle/
      app/
      build.gradle.kts
      settings.gradle.kts
  scripts/
    check-environment.*
  README.md
  spec.md
```

This structure is a suggestion, not a mandate. Keep the project modular but not over-engineered. Ignore all temporary artifacts, signing material, and build outputs in Git.

## 11. Local setup and operating instructions

Document exact setup steps in `README.md` and provide helpful failures when prerequisites are absent.

**Required on the machine running the generator:**

- Node.js version supported by the selected Next.js release.
- Java JDK compatible with the pinned Android Gradle Plugin.
- Android SDK (platform/build-tools versions compatible with the template), with `ANDROID_HOME` or `ANDROID_SDK_ROOT` configured as appropriate.
- Android SDK licenses accepted.
- Sufficient local RAM and disk space for Gradle builds.

**Recommended first-run procedure:**

1. Install project dependencies with the project's chosen Node package manager.
2. Install JDK + Android SDK and accept licenses locally.
3. Run the environment-check script to verify tools and SDK components.
4. Build `templates/android` independently once to populate Gradle caches and verify the toolchain.
5. Start the Next.js server locally.
6. Open the generator UI, enter an HTTPS URL, and generate an APK.
7. Install the resulting debug APK on an emulator or Android device (for example, through `adb install`).

Do not require the user to provision any hosted account, create a DB, obtain API keys, deploy a second backend, configure cloud credentials, or configure a remote build runner.

**Offline qualification:** The generator does not need a third-party conversion service. Initial installation/builds may download package and Android dependencies from standard registries, unless they are already cached. The generated APK subsequently accesses its configured website as needed.

## 12. Testing and acceptance criteria

### Build workflow

- [ ] A user can enter an HTTPS URL, name, and application ID with sensible defaults.
- [ ] An optional icon is handled entirely locally; an absent icon falls back to a bundled asset.
- [ ] Invalid URLs, host lists, package IDs, and unsupported inputs show useful errors.
- [ ] The app detects missing local Android prerequisites before attempting a build.
- [ ] Clicking **Generate APK** creates a real build job and reports progress.
- [ ] The build produces a real **debug-signed, installable** APK; not a fake artifact.
- [ ] Download works from the same self-hosted machine.
- [ ] Two simultaneous requests are safely serialized or rejected according to clear queue limits.
- [ ] Temporary builds and APKs are removed after expiry; a restart does not require a DB recovery step.
- [ ] All of the above works without any database, cloud storage, third-party conversion API, or external job worker.

### Android app

- [ ] App label, icon, starting URL, and application ID match submitted configuration.
- [ ] Allowed HTTPS same-host navigation works, including normal in-site SPA navigation.
- [ ] Host lookalikes, off-domain navigation, and HTTP navigation are rejected in applicable flows.
- [ ] `target=_blank` and JavaScript popup attempts cannot open an ungoverned in-app browser.
- [ ] Android back navigation behaves normally.
- [ ] Offline/error state and Retry work.
- [ ] JavaScript, site cookies, and ordinary subresources work for a representative trusted website.
- [ ] Normal website updates appear without rebuilding the APK.
- [ ] APK does not depend on the generator process once installed.
- [ ] Known POST-navigation/WebView limitations are documented and tested rather than hidden.

### Testing expectations

- Include unit tests for URL/host normalization and allowlist edge cases.
- Test the built APK on at least one Android emulator/device, not only by checking a file path.
- Include a tiny local HTML test fixture with navigation examples: same host, other host, lookalike host, HTTP, redirect, `target=_blank`, JS navigation, and form POST. This fixture is test infrastructure inside the repository, **not** an external service.
- Pin and document the Android SDK/Gradle/Kotlin/JDK compatibility combination rather than guessing versions at runtime.

## 13. Out of scope in v1

- iOS builds, IPA signing, Xcode automation, TestFlight, App Store.
- Google Play uploads, AAB export, publishing automation.
- Release keystore management (beyond documenting how future release signing works).
- Accounts, access control for multi-user public hosting, subscriptions, team workspaces.
- Persisted projects, revision history, dashboards, databases.
- External object storage, email, webhooks, cloud queues, telemetry services.
- Browser extensions, web crawling/mirroring, custom site injection.
- Universal strict outbound network filtering or a claim that WebView equals a hardened browser sandbox.
- Custom camera, GPS, notifications, file upload/download, or authentication bridge features.

## 14. Future iOS extension (design for, do not implement)

The only requirement for iOS now is to avoid coupling the entire configuration/build flow to Android-specific assumptions.

- Preserve the versioned, platform-neutral fields in the JSON configuration.
- Keep `platform: "android"` explicit and model build results as artifact metadata, not as hardcoded APK-only UI state in every layer.
- Keep Android-specific code under a platform-specific template/builder module.
- A future iOS builder will be a separate Swift/WKWebView template running on macOS with Xcode.
- Future iOS exports may include an Xcode project and appropriately signed IPA, subject to Apple's signing/provisioning and distribution requirements.
- Do not add Swift code, macOS build support, or iOS UI switches in this milestone.

## 15. Implementation guidance for a coding agent

Implement this as a complete working project, not merely a mock UI or collection of TODOs. Use existing repository conventions if a Next.js app is already scaffolded. Inspect the environment and available installed frontend/Radix skills before introducing libraries. Prioritize a solid generator flow, reliable Android build template, and correct default navigation behavior over decorative features.

Proceed in this order:

1. Build and verify a minimal standalone Android WebView template manually.
2. Implement configuration validation, navigation policy, and tests.
3. Implement local Android template parameterization and `assembleDebug` orchestration.
4. Implement in-memory job queue, status endpoint, downloadable artifact, and cleanup.
5. Build the polished single-page Next.js frontend.
6. Test end-to-end APK generation and install the output on an emulator/device.
7. Write a usable README with real prerequisites, commands, limitations, and troubleshooting.

**Definition of done:** From a local web form, a user can produce, download, and install an Android APK that opens their chosen live HTTPS site inside a restricted-navigation WebView, without provisioning any external database, storage service, API, or build service.
