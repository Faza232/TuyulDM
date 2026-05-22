# TuyulDM

A high-throughput, IDM-class download manager that runs as a Manifest V3 browser
extension backed by a native Go daemon. Captures direct files, HLS, DASH, and
adapter-resolved media streams. Mux-and-finalize happens server-side; the
extension surface stays a thin observer of canonical `MediaOffer` objects.

## Architecture

| Layer | Path | Role |
| --- | --- | --- |
| Native host | `native-host/` | Go 1.22+. Multi-segment HTTP, HLS/DASH planners, ffmpeg-driven assembly, throttling, scheduling. |
| Extension (MV3) | `extension/src/` | Background service worker, content script, page hook. Detects media offers, intercepts browser downloads, sends to host. |
| UI surfaces | `src/` | React 19 + Tailwind. Three entries: `dashboard.tsx`, `popup.tsx`, `options.tsx`. Shared primitive library in `src/ui/primitives/`. |
| Dev shim | `server.ts` | Express + Vite dev server. Mirrors host RPC over HTTP so the UI runs without the extension during development. |

The MV3 background and the Go daemon talk over native messaging: 4-byte
length-prefixed NDJSON over stdin/stdout. The UI surfaces never talk to the
daemon directly — they go through `bridge.ts`, which targets either the
extension runtime or the dev HTTP server.

## Repository layout

- `src/` — React UI: surfaces, state hooks, primitives.
  - `src/state/` — zustand stores + bridge + persisted UI settings.
  - `src/ui/primitives/` — Button, Dialog, Drawer, CommandPalette, etc.
  - `src/surfaces/{dashboard,popup,options}/` — one entry per browser surface.
- `extension/` — MV3 manifest, background, content scripts.
- `native-host/` — Go daemon and tests.
- `scripts/` — install scripts and tooling.

## Build

### Native host

```bash
cd native-host
go build -o tuyuldm-daemon ./...
```

Bundle an ffmpeg sidecar:

- Linux: `native-host/bin/ffmpeg-linux-{amd64,arm64}`
- macOS: `native-host/bin/ffmpeg-darwin-{amd64,arm64}`
- Windows: `native-host\bin\ffmpeg-windows-amd64.exe`

For dev, point at any local ffmpeg: `TUYULDM_FFMPEG=/usr/bin/ffmpeg`.

### Extension

```bash
npm install
npm run build           # Chromium target
npm run build:firefox   # Firefox target
```

The buildable artifact is `dist/`. Load **only** `dist/` in
`chrome://extensions` with Developer Mode → Load Unpacked. The raw `extension/`
directory is source — it points at TypeScript entrypoints that Vite/CRX
rewrites; it is not loadable as-is.

Note the Extension ID after loading.

### Native messaging registration

Linux / macOS, one command:

```bash
scripts/install-host.sh <EXTENSION_ID>
```

Builds the daemon if needed, renders `extension/com.tuyuldm.daemon.json.template`
with the daemon's absolute path and your extension ID, and installs the manifest
into every supported browser's `NativeMessagingHosts` directory.

Windows: render the template into `%LOCALAPPDATA%\TuyulDM\com.tuyuldm.daemon.json`
and add a registry key under
`HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.tuyuldm.daemon`
whose default value is the absolute path to that JSON. A
`scripts/install-host.ps1` is on the roadmap.

## Development

### UI alone (no extension)

```bash
npm run dev
```

Boots Vite + Express on `http://localhost:5173`. The dev server mirrors the
host's RPC surface (`/api/downloads`, `/api/stats`, …) so the dashboard renders
against fake state without loading an unpacked extension. Useful for iterating
on primitives, routes, and design tokens.

### Typecheck

```bash
npm run lint   # tsc --noEmit
```

### Native host tests

```bash
go test ./native-host/...
```

### CI

`.github/workflows/ci.yml` runs `npm ci`, `tsc --noEmit`, and `go test`
on every push and pull request.

## Data directory

Per-user canonical:

- Linux: `$XDG_DATA_HOME/tuyuldm` (fallback `~/.local/share/tuyuldm`)
- macOS: `~/Library/Application Support/TuyulDM`
- Windows: `%LOCALAPPDATA%\TuyulDM`

Downloads, the SQLite database, and host logs all live here.

## Design system

Dark, dense, monospaced. Single accent (`#FAFAFA` on `#0A0A0A`). All tokens
live in `src/index.css` under `@theme`. UI code consumes them as
`var(--color-…)` / `var(--radius-…)` / `var(--motion-…)` — no raw hex, no
bespoke radii.

Primitive set (in `src/ui/primitives/`):
`Button`, `IconButton`, `Input`, `Select`, `Checkbox`, `Switch`, `Tabs`,
`Badge`, `Chip`, `Tooltip`, `Kbd`, `Dialog`, `Drawer`, `Menu`, `Toast`,
`CommandPalette`, `Toolbar`, `Sidebar`, `Row`, `ProgressBar`, `EmptyState`.

Surfaces never talk to lucide or motion directly — icons come from
`src/ui/icons.ts`, motion config from the shared `AppRoot` provider.

## License

Apache License 2.0 — see [`LICENSE`](./LICENSE).
