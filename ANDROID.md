# The Android app

`georgelands.com` ships as an installable Android app. It is a **Trusted Web
Activity** (TWA): a thin native shell that hands the whole screen to Chrome,
pointed at the live site. There is no second copy of the site, no WebView
re-implementation, and nothing to keep in sync — deploy the site and the app is
updated, because the app *is* the site.

The one thing the shell buys you is the missing browser chrome. Chrome will only
hide the URL bar for an origin that proves the app is allowed to speak for it,
which is what `/.well-known/assetlinks.json` does.

## The multi-origin part (this is the whole trick)

The hub lives on the apex, but every project lives on its own subdomain — and a
subdomain is a **separate origin**. Chrome checks trust per origin, so the app
needs all six to line up:

| Origin | Trusted because |
|--------|-----------------|
| `georgelands.com` | `hostName` in `android/twa-manifest.json` |
| `roadtrip.georgelands.com` | listed in `additionalTrustedOrigins` |
| `availability.georgelands.com` | listed in `additionalTrustedOrigins` |
| `bustracker.georgelands.com` | listed in `additionalTrustedOrigins` |
| `citywatch.georgelands.com` | listed in `additionalTrustedOrigins` |
| `flights.georgelands.com` | listed in `additionalTrustedOrigins` |

and **each of those six origins must serve the identical
`/.well-known/assetlinks.json`**. The edge does that for all six from one file
(`site/.well-known/assetlinks.json`) — see the `(assetlinks)` snippet in
`caddy/Caddyfile`. Projects never touch it.

Miss any one of them and the failure is quiet: the app still works, you never
leave it, but that one subdomain opens with a URL bar and an ✕ button.

> **`additionalTrustedOrigins` takes BARE HOSTNAMES — no `https://`.**
> Bubblewrap's templates add the scheme themselves. Writing
> `"https://roadtrip.georgelands.com"` generates
> `<item>https://https://roadtrip.georgelands.com</item>`, builds and installs
> without complaint, and puts the URL bar back. Several popular public examples
> get this wrong. After any `init`/`update`, check
> `android/app/src/main/res/values/strings.xml` and confirm exactly one
> `https://` per `<item>`.

## The signing key

    ~/Projects/keys/georgelands-twa.keystore            alias: georgelands
    ~/Projects/keys/georgelands-twa.keystore.password   (mode 600)

    SHA-256: EC:C2:7D:99:B3:D6:A2:E6:7A:C8:CC:BA:D6:C4:9A:7A:
             C5:86:C7:75:E2:82:2A:EE:DE:B3:40:C4:32:16:F1:65

**Back this up.** That fingerprint is baked into `assetlinks.json` on the live
site, so the app and the site are joined by this one key. Signing with a
different key doesn't error — it just silently fails verification and the URL
bar comes back everywhere. It is deliberately outside the repo; never commit it.

It's a PKCS12 keystore, which does **not** support a separate key password: the
store password and key password must be the same string. Both env vars below get
the same value for that reason.

## Build

Bubblewrap needs Node ≥ 18 and **exactly JDK 17** (it string-matches
`JAVA_VERSION="17.0`, so 11 and 21 are both rejected). The `node` on `PATH` here
is v14, which dies with `Cannot find module 'node:events'` — pin Homebrew's Node
for every invocation. Installing the CLI under Node 14 / npm 6 also produces a
silently broken dependency tree, so install under Node 24 too.

Let Bubblewrap download and manage its own JDK and Android SDK under
`~/.bubblewrap` (~425 MB, once). **Do not point it at `~/Library/Android/sdk`.**
That SDK has a 2017-era `tools/` package, and Bubblewrap probes
`<sdk>/tools/bin/sdkmanager` *first* — that binary throws `NoClassDefFoundError:
javax/xml/bind/annotation/XmlSchema` on any JDK ≥ 9 and exits 0, so the failure
is swallowed. `bubblewrap doctor` will happily call that SDK valid: it only
checks the directory exists and contains `tools` or `bin`, never that build-tools
36.1.0 is present or that sdkmanager runs.

```bash
export PATH="/opt/homebrew/opt/node/bin:$PATH"
export BUBBLEWRAP_KEYSTORE_PASSWORD="$(cat ~/Projects/keys/georgelands-twa.keystore.password)"
export BUBBLEWRAP_KEY_PASSWORD="$BUBBLEWRAP_KEYSTORE_PASSWORD"

cd android                    # `build` ignores --directory and runs gradle in
                              # the CWD, so the cd is not optional
bubblewrap update --skipVersionUpgrade
bubblewrap build
```

`update` regenerates the Gradle project from `twa-manifest.json`; `build`
compiles and signs it. That emits `app-release-signed.apk` — and an
`app-release-bundle.aab`, which is a Play publishing format: **ignore it**,
`adb install` cannot install an AAB.

`--skipVersionUpgrade` keeps the version exactly as `twa-manifest.json` declares
it; without the flag `update` stops to ask interactively. To cut a new version,
bump `appVersion` and `appVersionCode` in `twa-manifest.json` by hand and
rebuild — the version then lives in the same reviewed file as everything else.

Signing is automatic (apksigner, v1+v2+v3 — a sideloaded app targeting SDK 36
requires v2 or later, which this satisfies). Nothing extra to run.

Expect a Gradle warning that AGP 8.9.1 "was tested up to compileSdk 35". The
template pins AGP 8.9.1 with compileSdk 36, so it is emitted on every build.
It is a warning, not a failure — don't chase it, and don't fix it by editing
generated files.

`bubblewrap build` regenerates the Gradle project from `twa-manifest.json` and
**overwrites** `strings.xml` / `AndroidManifest.xml`. Edit `twa-manifest.json`
and rebuild; never patch the generated XML.

Do **not** run `bubblewrap validate` — it calls the PageSpeed Insights API with
a `pwa` category that Lighthouse dropped in Oct 2025, so it errors out and looks
like a broken build when nothing is wrong. (`--skipPwaValidation` is a dead flag
in 1.25.0 for the same reason: build-time validation was removed in 2022.)

## Install on the phone

One-time on the Pixel: **Settings → About phone → Build number**, tap 7×, then
**Settings → System → Developer options → USB debugging**. Plug in over USB and
accept the RSA prompt ("Always allow from this computer").

`adb install` runs as the shell user, so "Install from unknown sources" is *not*
required.

```bash
adb devices -l                       # confirm the phone shows as `device`
adb install android/app-release-signed.apk
```

Re-installing over a build signed with a different key fails with
`INSTALL_FAILED_UPDATE_INCOMPATIBLE` — `adb uninstall com.georgelands.app`
first. If you hit odd streaming errors (adb 34 against a targetSdk-36 APK), add
`--no-streaming`.

## Verify

The real acceptance test needs no tooling: **open the app and tap through to
each of the four projects. A URL bar means that origin failed verification.**

```bash
# every origin must return 200 + application/json, with no redirect
for h in georgelands.com roadtrip.georgelands.com availability.georgelands.com \
         bustracker.georgelands.com citywatch.georgelands.com; do
  printf '%-34s %s\n' "$h" "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' \
    "https://$h/.well-known/assetlinks.json")"
done

adb shell pm get-app-links --user cur com.georgelands.app   # all 5 hosts: verified
adb logcat | grep -E 'OriginVerifier|digital_asset_links'   # the live check
```

Verification is asynchronous — `none` right after install is normal. Force a
recheck:

```bash
adb shell pm set-app-links --package com.georgelands.app 0 all
adb shell pm verify-app-links --re-verify com.georgelands.app
```

Chrome does **not** keep a sticky cache of a *failed* verification — it re-fetches
`assetlinks.json` over the network and only consults its stored result when the
device is offline. So don't burn time on `pm clear com.android.chrome`. If a
subdomain still shows a URL bar after the file is provably correct, the real
suspects are Chrome's ordinary HTTP cache for that URL and a TWA activity you
haven't actually restarted.

## Adding a project to the app

Registering a project on the platform (`CONTRACT.md`) gets it a subdomain and a
card. Getting it *inside the app* without a URL bar takes two more edits:

1. `caddy/Caddyfile` — the project's block needs `import assetlinks`. CI fails
   the build if it's missing.
2. `android/twa-manifest.json` — add the bare hostname to
   `additionalTrustedOrigins`, then rebuild and reinstall.

Step 1 alone is not enough: the origin will serve the file, but the app won't
have been told to trust it.

## Verified on device

Installed on a Pixel 9 Pro XL (Android 16) on 2026-08-17 and checked end to end:

```
pm get-app-links com.georgelands.app
  Signatures: [EC:C2:7D:99:…:F1:65]        <- matches the APK and all six origins
  georgelands.com:              verified
  roadtrip.georgelands.com:     verified
  availability.georgelands.com: verified
  bustracker.georgelands.com:   verified
  citywatch.georgelands.com:    verified
```

The hub and all four projects open full-screen with no URL bar, including when
tapping through from the hub to a project — which is the cross-origin case the
whole `additionalTrustedOrigins` + per-origin asset-links setup exists for.
The calendar keeps its signed-in session, because a TWA shares Chrome's cookie
jar rather than running its own.

Edge-to-edge under targetSdk 36 turned out to be a non-issue: Chrome insets the
web content itself, so the navbar sits correctly below the status bar and no
`viewport-fit=cover` / `env(safe-area-inset-*)` work was needed. If that ever
regresses after a Chrome update, that pair is the fix — and it would need
applying in each project's own CSS too, since they all render in this window.

One thing deliberately left off: Android's "open supported links" selection
state is `Disabled`, so tapping a `georgelands.com` link in another app still
opens the browser rather than this app. Domain verification (what removes the
URL bar) is independent of it. Turn it on under **Settings → Apps → GeorgeLands
→ Open by default** if you want links to route into the app.
