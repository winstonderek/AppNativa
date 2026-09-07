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
| `npm run publish` | Publish to GitHub Releases (requires publisher config) |

## Versioning

Semantic versioning starting at `1.0.0`:

```bash
npm version patch   # 1.0.1
npm version minor   # 1.1.0
npm version major   # 2.0.0
```

Tag releases with `v*` (e.g. `v1.0.0`) to trigger GitHub Actions builds.

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
| `APPLE_IDENTITY` | macOS code signing identity |
| `APPLE_ID` | Apple ID for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization |
| `APPLE_TEAM_ID` | Apple Developer Team ID |
| `GITHUB_TOKEN` | GitHub Releases publishing |
| `GITHUB_REPOSITORY_OWNER` | Publisher config override |
| `GITHUB_REPOSITORY_NAME` | Publisher config override |
| `WINDOWS_CERTIFICATE_PASSWORD` | Windows code signing (CI) |

## Code signing

### macOS

1. Enroll in the Apple Developer Program.
2. Create a **Developer ID Application** certificate.
3. Set secrets in GitHub Actions:
   - `APPLE_IDENTITY` — e.g. `Developer ID Application: Your Name (TEAMID)`
   - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
4. Hardened runtime entitlements are in `entitlements.plist` (camera, mic, screen recording, network).

### Windows

1. Obtain an Authenticode code signing certificate.
2. Store the certificate as a GitHub secret and configure signing in CI.
3. Squirrel.Windows produces `Pynn-Setup.exe`.

Signing is skipped when secrets are not configured — builds still succeed for testing.

## Auto-update

Configured via `electron-updater` in `src/main/updater.ts`:

- Disabled in development
- Checks for updates 10 seconds after launch in production
- Requires a published GitHub Release with assets from `npm run publish`
- Update `forge.config.ts` publisher repository to match your GitHub repo

## GitHub Actions

Workflow: `.github/workflows/build-desktop.yml`

- **macOS** (`macos-latest`) → `.dmg` + `.zip`
- **Windows** (`windows-latest`) → `.exe` + `.zip`

Push to `main` or tag `v*` to trigger builds. Artifacts are uploaded for download from the Actions run.

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
