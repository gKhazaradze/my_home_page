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
needs all five to line up:

| Origin | Trusted because |
|--------|-----------------|
| `georgelands.com` | `hostName` in `android/twa-manifest.json` |
| `roadtrip.georgelands.com` | listed in `additionalTrustedOrigins` |
| `availability.georgelands.com` | listed in `additionalTrustedOrigins` |
| `bustracker.georgelands.com` | listed in `additionalTrustedOrigins` |
| `citywatch.georgelands.com` | listed in `additionalTrustedOrigins` |

and **each of those five origins must serve the identical
`/.well-known/assetlinks.json`**. The edge does that for all five from one file
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

Bubblewrap needs Node ≥ 18 and JDK 17. The `node` on `PATH` here is v14 (nvm's
default), which fails with confusing errors, so pin Homebrew's Node. Bubblewrap
downloads and manages its own JDK 17 and Android SDK under `~/.bubblewrap` —
let it, because it pins build-tools 36.1.0 and the SDK at
`~/Library/Android/sdk` only has 33.0.0 and no `sdkmanager`.

```bash
export PATH="/opt/homebrew/opt/node/bin:$PATH"
export BUBBLEWRAP_KEYSTORE_PASSWORD="$(cat ~/Projects/keys/georgelands-twa.keystore.password)"
export BUBBLEWRAP_KEY_PASSWORD="$BUBBLEWRAP_KEYSTORE_PASSWORD"

cd android
bubblewrap build
```

That emits `app-release-signed.apk` (and an `app-release-bundle.aab`, which is
a Play publishing format — **ignore it**, `adb install` cannot install it).
Bubblewrap zipaligns and signs with v1+v2+v3 automatically; nothing else to run.

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

Chrome caches results per package+origin, so after fixing `assetlinks.json`
reinstall the APK (or `adb shell pm clear com.android.chrome`, which signs you
out of Chrome) before concluding it's still broken.

## Adding a project to the app

Registering a project on the platform (`CONTRACT.md`) gets it a subdomain and a
card. Getting it *inside the app* without a URL bar takes two more edits:

1. `caddy/Caddyfile` — the project's block needs `import assetlinks`. CI fails
   the build if it's missing.
2. `android/twa-manifest.json` — add the bare hostname to
   `additionalTrustedOrigins`, then rebuild and reinstall.

Step 1 alone is not enough: the origin will serve the file, but the app won't
have been told to trust it.

## Known rough edge

Bubblewrap targets SDK 36, so on Android 15/16 the app is subject to mandatory
edge-to-edge — web content can draw under the status and gesture bars. The site
uses the default `viewport-fit`, which asks the browser to inset content for us.
If the navbar ends up under the status bar on the device, the fix is
`viewport-fit=cover` plus `env(safe-area-inset-*)` padding in `styles.css` —
and the same fix in each project's own CSS, since they render in the same
full-screen window.
