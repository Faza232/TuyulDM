# TuyulDM - Milestone 0 Boilerplate

This project contains the skeleton for **TuyulDM**, an IDM-like download manager.

## Structure

- `/src`: The React UI. Three surfaces share one primitive library and one state core (see [UI architecture](#ui-architecture)).
- `/native-host`: The Go (1.23+) source code for the native messaging host.
- `/extension`: The Manifest V3 source for the browser extension (background, content scripts, shared media classifier).

## UI architecture

The UI is split into three surfaces, each with one job, backed by a shared design system and a single typed state layer.

```
src/
  index.css              design tokens (@theme): colors, radius, motion
  dashboard.tsx          entry → mounts Dashboard surface  (index.html)
  popup.tsx              entry → mounts Popup surface      (popup.html, 360×520)
  options.tsx            entry → mounts Options surface    (options.html)
  ui/
    tokens.ts            JS mirror of CSS tokens + density metrics
    icons.ts             curated lucide re-exports (swap point)
    primitives/          Button, Input, Dialog, Drawer, Menu, Toast, Tabs, … + barrel
    CommandPalette.tsx   ⌘K fuzzy command surface
    format.ts            shared formatters (size, speed, labels)
    _a11y_notes.md       per-surface tab order + ARIA contract
  state/
    bridge.ts            single typed client for chrome-runtime / native-host / dev-server
    store.tsx            StateProvider + useDownloads / useDetection / useSettings / useSystem
    toast.tsx            ToastProvider + useToasts
    preferences.tsx      UI prefs (density, accent, segments) + adapter settings
    shortcuts.ts         global keyboard map (sequences + mod combos)
    commands.ts          command registry + fuzzy match
    messages.ts          errorMessage / refusalMessage + recovery actions
    normalize.ts         settings/stream normalizers
  surfaces/
    dashboard/           Dashboard shell, Sidebar, TopBar, routes/, components/
    popup/               single-purpose grabber → hands off to dashboard queue
    options/             tabbed settings (General, Detection, Network, Adapters, Storage, Logging, About)
```

Rules: primitives are shared (no per-surface forks), surfaces never import each other, every offer field (strategy, tracks, plan, assembly stage, expiry, refusal reason) has one visual home, and `extension/src/shared/media_classify` stays the single source for strategy labels. All styling is Tailwind utilities + tokens — no per-component CSS, no shadcn dependency.

## How to Get Started (Milestone 0)

### 1. Build the Native Host
You must have Go 1.22+ installed.
```bash
cd native-host
go build -o tuyuldm-daemon ./...
```

For video downloads, the daemon expects a bundled ffmpeg sidecar next to the built binary:

- Linux: `native-host/bin/ffmpeg-linux-amd64` or `native-host/bin/ffmpeg-linux-arm64`
- macOS: `native-host/bin/ffmpeg-darwin-amd64` or `native-host/bin/ffmpeg-darwin-arm64`
- Windows: `native-host/bin/ffmpeg-windows-amd64.exe`

During local development you can override this with `TUYULDM_FFMPEG=/absolute/path/to/ffmpeg`.

### 2. Load the Extension
1. Build the extension bundle:
	```bash
	npm run build
	```
1. Load only the built `dist/` bundle.
   Source files under `extension/src/` and the source `extension/manifest.json` intentionally reference TypeScript entrypoints for Vite/CRX rewrite. They are not loadable as an unpacked extension by themselves.
1. Open Chrome/Brave and go to `chrome://extensions`.
2. Enable "Developer mode".
3. Click "Load unpacked" and select the `/dist` folder in this project.
4. Note the Extension ID (e.g., `abcdefg...`).

Never load repo root or `extension/` directly in the browser. Always load `dist/` after `npm run build`.

### 3. Register the Native Host

**Linux / macOS** — one command:

```bash
scripts/install-host.sh <EXTENSION_ID>
```

This builds the daemon (if needed), renders `extension/com.tuyuldm.daemon.json.template` with the daemon's absolute path and your extension ID, and writes the result to every supported browser's `NativeMessagingHosts` directory.

**Windows** — manual for now (a `scripts/install-host.ps1` is on the roadmap):

1. Build `native-host\tuyuldm-daemon.exe`.
2. Copy `extension\com.tuyuldm.daemon.json.template` to e.g. `%LOCALAPPDATA%\TuyulDM\com.tuyuldm.daemon.json`, replacing `__DAEMON_PATH__` and `__EXTENSION_ID__`.
3. Add a registry key at `HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.tuyuldm.daemon` whose default value is the absolute path to that JSON file.

### 4. Data directory

The daemon stores its database and downloads under a per-user canonical path:

- Linux: `$XDG_DATA_HOME/tuyuldm` (fallback `~/.local/share/tuyuldm`)
- macOS: `~/Library/Application Support/TuyulDM`
- Windows: `%LOCALAPPDATA%\TuyulDM`

## Features
- **Multi-segment Architecture**: Go host handles raw TCP/HTTP range requests.
- **IPC Protocol**: 4-byte length prefix NDJSON over stdin/stdout.
- **MV3 Interception**: Uses `chrome.downloads.onCreated` to hijack browser downloads.

## License

Apache License 2.0 — see [`LICENSE`](./LICENSE).
