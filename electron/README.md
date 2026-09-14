# Pynn Desktop

Official cross-platform desktop client for [Pynn](https://angelhive.pynn.ai).

This project is **completely independent** from the Pynn web application. It loads the remote web app over HTTPS inside a secure Electron shell — no changes to the Next.js codebase are required.

## Requirements

- Node.js 20 LTS (or newer LTS compatible with Electron 34)
- npm 10+
- macOS or Windows for local development
- For packaging: macOS to build `.dmg`, Windows to build `.exe` (or use GitHub Actions)

## Quick start

```bash
cd electron
npm install
npm start
```

This opens Pynn in a desktop window at `https://angelhive.pynn.ai`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Build TypeScript and launch in development mode (DevTools enabled) |
| `npm run build` | Compile TypeScript and copy static assets |
| `npm run lint` | Type-check without emitting |
| `npm run package` | Package without installers |
| `npm run make` | Build platform installers (`.dmg`, `.exe`, `.zip`) |
| `npm run publish` | Build and upload to a **draft** GitHub Release (`GITHUB_TOKEN` required). CI publishes non-draft releases from `v*` tags. |

## Versioning

Semantic versioning starting at `1.0.0`. The Git tag **must** match `electron/package.json`:

```bash
cd electron
npm version patch   # 1.0.1 — updates package.json and creates git tag v1.0.1
git push origin HEAD --tags
```

`npm version minor` / `npm version major` work the same way. Pushing a `v*` tag triggers GitHub Actions, which builds installers and publishes a GitHub Release. Clients with a packaged build then pick up that release automatically.

Do not tag `v1.0.1` while `package.json` still says `1.0.0` — the workflow will fail on purpose.

## Project structure

```
electron/
├── src/
│   ├── main/           # Main process (window, permissions, downloads, etc.)
│   ├── preload/        # Secure preload script (minimal contextBridge)
│   └── shared/         # Constants and URL utilities
├── static/             # Loading and error pages
├── assets/             # App icons (replace placeholders before release)
├── scripts/            # Build helpers
├── app-update.yml      # electron-updater GitHub feed (bundled into the app)
├── forge.config.ts     # Electron Forge packaging config
└── entitlements.plist  # macOS hardened runtime entitlements
```

## Application ID

- **Name:** Pynn
- **Bundle ID:** `ai.pynn.desktop`
- **Deep link protocol:** `pynn://`

Examples (prepared for future use):

- `pynn://call/123`
- `pynn://chat/456`
- `pynn://startup/789`

## Security model

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `webSecurity: true` (never disabled)
- Remote content treated as untrusted
- Navigation restricted on the main window to `angelhive.pynn.ai` and subdomains
- Stripe Checkout / Customer Portal (`checkout.stripe.com`, `billing.stripe.com`, `pay.stripe.com`) open in an in-app window; success/cancel URLs return to the main window
- Other external links validated before `shell.openExternal()`
- Invalid TLS certificates rejected in production
- No sensitive data in logs (tokens, cookies, passwords redacted)

## Icons

Placeholder icons are generated automatically on `npm install`. **Replace before public release:**

- `assets/icon.png` — 512×512 or 1024×1024 PNG
- `assets/icon.ico` — Windows
- `assets/icon.icns` — macOS

Generate proper platform icons from your PNG using [icon-gen](https://www.npmjs.com/package/icon-gen) or similar tools.

## Environment variables

| Variable | Used for |
|----------|----------|
| `NODE_ENV=development` | Enables DevTools, verbose logging, certificate bypass |
| `APPLE_IDENTITY` | macOS code signing identity, e.g. `Developer ID Application: Pynn (TEAMID)` |
| `APPLE_ID` | Apple ID email used for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password (not the Apple ID password) |
| `APPLE_TEAM_ID` | 10-character Apple Developer Team ID |
| `APPLE_CERTIFICATE` | Base64 of the Developer ID Application `.p12` (CI) |
| `APPLE_CERTIFICATE_PASSWORD` | Password of that `.p12` |
| `WINDOWS_CERTIFICATE` | Base64 of the Authenticode `.pfx` (CI) |
| `WINDOWS_CERTIFICATE_FILE` | Path to the `.pfx` on disk (set automatically in CI) |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password of that `.pfx` |
| `SQUIRREL_ICON_URL` | HTTPS URL of `icon.ico` for Squirrel shortcuts |
| `GITHUB_TOKEN` | GitHub Releases publishing |
| `GITHUB_REPOSITORY_OWNER` | Publisher config override |
| `GITHUB_REPOSITORY_NAME` | Publisher config override |
| `GITHUB_RELEASE_DRAFT` | Set to `false` to publish a non-draft GitHub Release (CI does this on tags). Local `npm run publish` stays draft. |

## Code signing

Add these as **GitHub Actions secrets** (repo → **Settings → Secrets and variables → Actions**). Never commit `.p12` / `.pfx` files.

| Secret | What to paste |
|--------|----------------|
| `APPLE_CERTIFICATE` | Base64 of the **Developer ID Application** `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Password you set when exporting the `.p12` |
| `APPLE_IDENTITY` | Exact identity string, e.g. `Developer ID Application: Pynn (ABCDE12345)` |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from [appleid.apple.com](https://appleid.apple.com) (`xxxx-xxxx-xxxx-xxxx`) |
| `APPLE_TEAM_ID` | 10-character Team ID from [developer.apple.com/account](https://developer.apple.com/account) |
| `WINDOWS_CERTIFICATE` | Base64 of the Authenticode `.pfx` |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password of that `.pfx` |
| `SQUIRREL_ICON_URL` | `https://raw.githubusercontent.com/DerekCourtBrain/AppNativa/main/electron/assets/icon.ico` |

### macOS

1. Apple Developer Program → **Certificates, Identifiers & Profiles** → create **Developer ID Application** (not Apple Development, not Mac App Store). Bundle ID for this app is `ai.pynn.desktop`.
2. Install the cert in Keychain (or Xcode). Confirm with:

   ```bash
   security find-identity -p codesigning -v
   ```

   Copy the line that starts with `Developer ID Application:` into `APPLE_IDENTITY`.
3. Export it: Keychain Access → **My Certificates** → the Developer ID Application cert → right click → **Export** → `.p12`, with a password.
4. Encode for GitHub (macOS):

   ```bash
   base64 -b 0 -i ~/Desktop/DeveloperID.p12 | pbcopy
   ```

   Paste that into `APPLE_CERTIFICATE`.
5. Create an **app-specific password** at appleid.apple.com → Sign-In and Security → App-Specific Passwords. Put it in `APPLE_APP_SPECIFIC_PASSWORD`. Do **not** use your Apple ID login password.
6. Hardened runtime entitlements are in `entitlements.plist` (camera, mic, screen recording, network).

### Windows

This path needs an exportable Authenticode `.pfx` (OV/EV that you can export, or a legacy software cert). If you only have **Azure Trusted Signing** or a USB hardware token, signing will not pick up these secrets — say so and we can wire that instead.

1. Export the cert as `.pfx` with a password (include the private key).
2. Encode for GitHub (PowerShell):

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\pynn.pfx")) | Set-Clipboard
   ```

   Paste that into `WINDOWS_CERTIFICATE`. Put the PFX password in `WINDOWS_CERTIFICATE_PASSWORD`.
3. Squirrel.Windows produces `Pynn-Setup.exe`. Forge signs both the packaged `pynn.exe` and the installer when those secrets are present.

Signing is skipped when secrets are not configured — builds still succeed for testing.

## Auto-update

Packaged builds check for a new GitHub Release 10 seconds after launch, download it in the background, then ask the user to restart. **Help → Check for Updates…** (Windows) or **Pynn → Check for Updates…** (macOS) runs the same check immediately. Disabled in development.

| Platform | Mechanism |
|----------|-----------|
| macOS | `electron-updater` + `latest-mac.yml` + the `.zip` in the GitHub Release. The app **must** be signed and notarized. |
| Windows | Squirrel (`Update.exe`) + `RELEASES` / `.nupkg` at `https://github.com/DerekCourtBrain/AppNativa/releases/latest/download` |

### Ship an update

1. Make sure [code signing](#code-signing) secrets are set. Unsigned macOS builds will not auto-update.
2. The GitHub repo must allow unauthenticated download of Release assets (public repo, or a public releases repo). Private assets 404 in the client.
3. Users need **one** install of a build that already contains this updater. Older shells will not self-update; send them `Pynn-Setup.exe` / `.dmg` once.
4. Bump `electron/package.json`, commit, tag `vX.Y.Z`, push the tag.
5. Wait for **Build Pynn Desktop** to finish. Confirm the GitHub Release is published (not draft) and includes:
   - macOS: `.dmg`, `.zip`, `latest-mac.yml`
   - Windows: `Pynn-Setup.exe`, `RELEASES`, `*.nupkg`, `latest.yml`
6. Restart a packaged client (or use **Check for Updates…**). It should download and offer to restart.

`latest.yml` / `latest-mac.yml` are generated by the Forge `postMake` hook. `app-update.yml` is bundled into the app resources so `electron-updater` knows which GitHub repo to query.

## GitHub Actions

Workflow: `.github/workflows/build-desktop.yml`

- **macOS** (`macos-latest`) → `.dmg` + `.zip` + `latest-mac.yml`
- **Windows** (`windows-latest`) → Squirrel `.exe` / `.nupkg` / `RELEASES` + `.zip` + `latest.yml`
- Push to `main` or a PR → build artifacts only
- Tag `v*` → same build, then a non-draft GitHub Release with those assets

CI currently builds **arm64 macOS** (`macos-latest`). Intel Macs need a separate `darwin/x64` (or universal) job if you support them.

## Native notifications

The web app already calls `pynnDesktop.showNotification` / `setUnreadCount`. The desktop shell shows an OS toast when Pynn is in the background. No Next.js changes are required.

### Windows

Toast notifications need a Start Menu shortcut whose AppUserModelID matches the running process. Squirrel writes `com.squirrel.Pynn.pynn`. The app:

- Sets that same ID (instead of `ai.pynn.desktop`, which made toasts fail silently)
- Creates or repairs the Start Menu shortcut on launch (Squirrel, ZIP, and older installs)
- Handles `--squirrel-install` / `--squirrel-updated` so the installer creates the shortcut
- Attaches the app icon to each toast

After installing a build with this fix, Pynn should appear under **Windows Settings → System → Notifications**. The first launch also posts a one-time registration toast.

### macOS

The first successful toast creates the **Pynn** row in **System Settings → Notifications**.

## System tray

A tray/menu bar icon is initialized when icons are available. Default behavior:

- **Open / Show / Hide / Quit** menu items
- Double-click to show the window
- Minimize-to-tray is **not** enabled by default (architecture prepared in `src/main/tray.ts` and `auto-start.ts`)

## Launch at startup

Disabled by default. Toggle programmatically via `setLaunchAtStartup(true)` in `src/main/auto-start.ts` (wire to a settings UI when needed).

## Native theme

The app detects system light/dark mode via `nativeTheme` but does **not** override the web app's own theme.

## Testing checklist

### Navigation

- [ ] Login / logout
- [ ] Internal navigation (Next.js routes)
- [ ] Back / forward (Alt+←/→ or Cmd+[/] on macOS)
- [ ] Refresh (Ctrl/Cmd+R) and hard reload (Ctrl/Cmd+Shift+R)

### Files

- [ ] File upload (`<input type="file">`)
- [ ] Multi-file upload
- [ ] Drag & drop
- [ ] Download (PDF, images, ZIP, etc.)
- [ ] Large file download

### Communication

- [ ] WebSockets / Socket.IO
- [ ] Reconnection after network change
- [ ] Desktop notifications

### Multimedia

- [ ] Microphone permission
- [ ] Camera permission
- [ ] WebRTC calls
- [ ] Screen sharing (macOS: grant Screen Recording to Pynn if prompted)
- [ ] Local camera stays visible as a small PiP during video / screen share
- [ ] Fullscreen (video calls, presentations)

### Browser APIs

- [ ] Cookies persist between sessions
- [ ] localStorage / sessionStorage / IndexedDB
- [ ] Clipboard copy/paste
- [ ] `alert` / `confirm` / `prompt` show a desktop dialog on macOS and Windows

### Desktop integration

- [ ] Window resize, maximize, minimize
- [ ] Window position/size remembered
- [ ] `angelhive.pynn.ai` links open in a new in-app window
- [ ] Stripe Checkout / billing portal stay inside the desktop app
- [ ] After paying or cancelling, the main window shows the Pynn return URL
- [ ] External links open in default browser
- [ ] macOS: close window keeps app running
- [ ] Windows: close exits app
- [ ] Installers run correctly
- [ ] Packaged build: Check for Updates finds a newer GitHub Release and restarts into it

## Development vs production

| Feature | Development | Production |
|---------|-------------|------------|
| DevTools | Enabled (F12, Cmd+Shift+I) | Disabled |
| Inspect Element in context menu | Yes | No |
| Certificate errors | Bypassed with warning | Blocked |
| Auto-update | Disabled | Enabled |
| Logging | Verbose | Sanitized |

## License

Proprietary — Pynn.
