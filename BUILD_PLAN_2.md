# TuyulDM — Build Plan 2 (Field-Test Fixes)

Follow-up to `BUILD_PLAN.md`. Issues found while dogfooding the M0–M5 build. Phases ordered by user pain. Each phase lists files to touch, acceptance, and a smoke test.

Status legend: ☐ todo · ◐ partial · ☑ done.

---

## Phase A — Error visibility & logging

### A.1 Structured file logging in the host

Today every native-host log is `fmt.Fprintln(os.Stderr, …)`. Stderr from a native-messaging host is captured by the browser to its own log and is essentially invisible to the user. Network errors, HEAD probe failures, retry exhaustion, and ffmpeg failures all vanish.

Tasks:

- Introduce `native-host/logging.go` that wires `log/slog` to a rotating file in `DataDir()/logs/tuyuldm.log`.
  - Use [`gopkg.in/natefinch/lumberjack.v2`](https://github.com/natefinch/lumberjack) for rotation (10 MB, keep 5).
  - JSON handler; level configurable via host settings (`logLevel`, default `info`).
  - Mirror to stderr at `warn+` so existing browser-captured logs still surface critical issues.
- Replace every `fmt.Fprintln(os.Stderr, …)` in `main.go`, `engine.go`, `video_download.go`, `scheduler.go`, `storage.go` with `slog.Info/Warn/Error` carrying structured fields (`download_id`, `url`, `attempt`, `segment_index`, `status_code`).
- Log on:
  - probe failure (HEAD + range fallback both rejected) — `engine.go: probeDownload`.
  - each segment retry, including `retryable_status` and `retry_after_ms`.
  - segment exhaustion (`segment %d exhausted retries`).
  - integrity check failure (`verifyDownloadIntegrity`).
  - ffmpeg mux failure (`muxVideoSegments`) — capture `cmd.CombinedOutput()` tail in the log entry.
  - host IPC unmarshal errors and unknown methods.

### A.2 Surface error context to the UI

- Extend `DownloadState` with `ErrorCode string` and `LastAttemptAt time.Time`. Set in `failDownload` and on each retryable error.
- Background broadcasts these via existing `PROGRESS_UPDATE`; `App.tsx` already shows `download.error`, add a tooltip-expanded panel that also shows `ErrorCode` and `LastAttemptAt`.
- Add a sidebar entry **Logs** that calls a new IPC method `host.openLogs` (Phase B.3 implements the file-open primitive — reuse it). On click, host opens the log file in the OS default app.

Acceptance:
- Force a 403 (use a private S3 URL). UI shows the error and tooltip exposes status code 403 and timestamp.
- `cat $XDG_DATA_HOME/tuyuldm/logs/tuyuldm.log` shows JSON lines with `download_id` filterable.

---

## Phase B — File location & access

### B.1 User-configurable download directory

`native-host/paths.go: DownloadsDir()` always returns `<DataDir>/downloads`. There is no way for the user to override.

Tasks:

- Add `DownloadDir string` to `HostSettings` (`native-host/host_settings.go`). Default to the OS user Downloads folder, NOT `<DataDir>/downloads`:
  - Linux: `$XDG_DOWNLOAD_DIR` if set in `~/.config/user-dirs.dirs`, else `$HOME/Downloads`.
  - macOS: `$HOME/Downloads`.
  - Windows: `SHGetKnownFolderPath(FOLDERID_Downloads)` via `golang.org/x/sys/windows` — fall back to `%USERPROFILE%\Downloads`.
  - Migration: if existing settings have empty `DownloadDir` but the legacy `<DataDir>/downloads` folder exists and is non-empty, set `DownloadDir` to that path so old downloads stay discoverable.
- `paths.go: DownloadsDir()` becomes a thin wrapper that consults `HostSettings.DownloadDir`, falling back to the OS default. Engine and video pipeline must read from `HostSettings`, not the global function — wire via `engine.HostSettings()` rather than re-resolving each time.
- Validate on `host.setSettings`:
  - path is absolute,
  - exists or can be created (`MkdirAll`),
  - writable (test by `os.CreateTemp`),
  - reject paths inside `DataDir()` to avoid mixing with the bbolt DB.
- Expose `HostSettings.DownloadDir` in the React settings panel (`src/App.tsx`) as a text field plus a **Browse…** button. Browse uses the new IPC `host.pickDirectory` (see B.4).

### B.2 Show the resolved output path on every download row

`DownloadState.OutputPath` already exists but the UI never displays it.

Tasks:

- `App.tsx` download row: under the filename show the parent directory in muted text, truncated. Tooltip = full absolute path.
- Add a copy-to-clipboard icon next to the path.

### B.3 Open file / reveal in folder

New IPC methods on the host:

- `host.openFile { id }` — resolve `state.OutputPath`, refuse if status is not `finished`, then platform open:
  - Linux: `xdg-open <file>`
  - macOS: `open <file>`
  - Windows: `rundll32 url.dll,FileProtocolHandler <file>` or `cmd /c start "" <file>`
- `host.revealInFolder { id }` — open the parent dir with the file selected when supported:
  - Linux: `xdg-open <dir>` (no select); attempt `dbus-send` to `org.freedesktop.FileManager1.ShowItems` first.
  - macOS: `open -R <file>`
  - Windows: `explorer /select,<file>`
- `host.openLogs` — wraps `host.openFile` on the log file path.

Validation: refuse any path not under the configured download dir (path traversal guard).

UI: download row gets two new icon buttons next to play/pause:

- Folder icon → `revealInFolder`
- External-link icon → `openFile` (disabled unless `status === 'finished'`)

### B.4 Directory picker

`host.pickDirectory { initial? }` — opens an OS native dialog and returns the chosen absolute path.

Implementation: shell out to platform helpers since we don't bundle a GUI toolkit.

- Linux: try `zenity --file-selection --directory`, fall back to `kdialog --getexistingdirectory`.
- macOS: `osascript -e 'POSIX path of (choose folder)'`.
- Windows: PowerShell `Add-Type -AssemblyName System.Windows.Forms; ([System.Windows.Forms.FolderBrowserDialog]::new()).ShowDialog()`.

If none of the helpers are present, return `{ status: "error", message: "no GUI dialog available; type path manually" }`. UI must gracefully fall back to a plain text input (already shipped per B.1).

Acceptance:
- Set custom download dir via Browse, restart browser, dir persists in bbolt and is honored.
- Finished file row → "Open" launches the OS player. "Reveal" opens the file manager.
- Path traversal payload `../etc/passwd` is rejected.

---

## Phase C — Video grabber works again

User reports two failures: clicking does nothing AND no detection in the browser. Both have separate root causes.

### C.1 Manifest detection misses most real streams

`background/index.ts: onHeadersReceived` filters on `types: ['xmlhttprequest', 'other']`. Modern players also fetch manifests as `media`, `fetch`, `sub_frame`, or via `<video src>` with type `main_frame`/`object`. And the `<all_urls>` listener silently no-ops until `optional_host_permissions` is granted.

Tasks:

- Broaden listener: `types: ['xmlhttprequest', 'media', 'other', 'sub_frame', 'object', 'main_frame']` (Chrome rejects some types in MV3 — verify by running with `--log-level=0`).
- Add URL-pattern fallback that does NOT require `host_permissions`: a `chrome.webNavigation.onCompleted` listener that runs a tiny content script (`scripting.executeScript`) which scans `document.querySelectorAll('video,source')` and `performance.getEntriesByType('resource')` for URLs ending in `.m3u8` / `.mpd`. This works on the active tab via `activeTab` permission, no host permission needed.
- When a manifest is detected, instead of immediately injecting the overlay, push the URL into a per-tab map. Overlay only renders when:
  1. User clicks the browser action and chooses "Detected Streams", OR
  2. Auto-show toggle (in interception settings) is enabled.
- Auto-dismiss after 30 s is too aggressive — bump to 5 minutes and let the user explicitly close. Better: render as a corner badge instead of full card; expand on hover.

### C.2 Overlay button is non-interactive

Inspecting `extension/src/content/index.ts: injectDetectedManifestOverlay` — the button has an `onclick` handler but the function is executed via `chrome.scripting.executeScript({ func: injectDetectedManifestOverlay, args: [...] })`. `scripting.executeScript` runs the function in the page's isolated world; closures capturing `chrome.runtime`-bound helpers DO survive, but `sendRuntimeMessage()` falls back to `chrome.runtime.sendMessage` which requires the receiving service worker to be alive AND `runtime` to be exposed in the isolated world — it is, but on some sites a strict CSP can block the synthesized `<button>` from receiving events when injected via `executeScript` if the host page wipes the DOM (single-page apps re-render).

Tasks:

- Switch from one-shot `scripting.executeScript` to a real content script registered in `manifest.json`:
  ```json
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["extension/src/content/index.ts"],
    "run_at": "document_idle"
  }]
  ```
  Plus `chrome.scripting.registerContentScripts` for dynamic registration on the active tab when host permission is denied.
- Have the content script listen for a `runtime.onMessage` event `{ type: "SHOW_VIDEO_OVERLAY", url, manifestType, schedule }` and render the overlay then. Background sends this instead of executing a function.
- Persist overlay in a Shadow DOM root attached to `document.documentElement` (not `document.body`) so SPA re-renders don't wipe it.
- Verify `pointer-events` and `z-index` against host-page CSS resets — set explicit `pointer-events: auto`, `z-index: 2147483647`, `all: initial` on the host element.

### C.3 Manual "Detect on this page" button

Add to the popup a button **Scan Page for Videos** that:

1. Calls `chrome.tabs.query({ active: true, currentWindow: true })`.
2. Sends `SCAN_PAGE_VIDEOS` to the content script.
3. Content script runs the heuristic from C.1 and replies with a list of `{ url, manifestType }`.
4. Popup renders a small list with **Grab** buttons.

This is the user's escape hatch when auto-detection misses a stream.

### C.4 Variant selection actually changes the download

`background.ts` reads `selectedVariantId` from the overlay and forwards it via `download.video`. Trace through `native-host/video_download.go: AddVideo` and `resolveVideoManifest` — confirm the selected variant URL is the one fed to `runVideoDownload`, not the master playlist. If `selectedVariantId` is empty, default to highest bandwidth (already done in `hls.go`?). Add a unit test in `video_manifest_test.go` that asserts the selected variant's segment URLs are present and the unselected one's are absent.

### C.5 DRM refusal user-facing

When `resolveVideoManifest` returns a DRM-protected manifest (HLS `METHOD=SAMPLE-AES`/`AES-128` with non-clear key, or DASH `ContentProtection` with non-clear `schemeIdUri`), the host returns an error string. Make the overlay render it prominently in red, with a "Why?" link to the DRM policy doc (Phase 8 in `BUILD_PLAN.md`).

Acceptance:
- Open Big Buck Bunny HLS sample → overlay appears, variants list populates, click Download → file downloads, ffmpeg muxes, finishes.
- Open YouTube → either DRM refusal banner or no overlay (YouTube uses Widevine; we refuse).
- Popup → Scan Page → returns at least one URL on a manifest-using site.

---

## Phase D — Per-item delete UX

`App.tsx:1172` has a bare `<button>` with no `onClick` — the X icon is decorative. Host has no `download.remove` method.

Tasks:

- New IPC: `download.remove { id, deleteFile bool }`.
  - `engine.go: Remove(id, deleteFile)`:
    1. If active, cancel and wait for goroutines (mirror `Pause` shutdown sequence).
    2. Remove from `e.active`, `e.queued`, `e.queuedSet`.
    3. If `deleteFile` and `state.Status == "finished"`, `os.Remove(state.OutputPath)`. Also wipe `videoSegmentDir(state)` for partial video downloads regardless.
    4. `storage.DeleteDownload(id)` — new method in `storage.go` calling `bucket.Delete([]byte(id))`.
- Background message handler: `REMOVE_DOWNLOAD { id, deleteFile }` → `download.remove`. On success, also remove the item from the in-memory `activeDownloads` set.
- UI: clicking the X opens a small confirm popover with two options:
  - **Remove from list** (deleteFile = false)
  - **Remove from list and delete file** (deleteFile = true, default for finished items; show in red)
  - Plus a Cancel.
- For multi-select removal (future): leave a TODO, ship single-item first.

Acceptance:
- Finished item → remove → choose "and delete file" → file is gone from disk, row is gone from UI, restarting browser does not bring it back.
- Active item → remove → choose "Remove from list" → background download is canceled, no half-written `.part` files left, row gone.
- Partial video (`.segments/<id>/`) → fully cleaned up.

---

## Phase E — Other bugs found in the review

### E.1 Manifest references unbuilt TypeScript paths

`extension/manifest.json` points `service_worker` at `extension/src/background/index.ts`. MV3 service workers cannot load `.ts` directly; the file must be the compiled JS path that `@crxjs/vite-plugin` emits. Same for `popup.html` referencing `./extension/src/popup/main.tsx`. This works only inside the Vite dev server, not when loading the unpacked extension from `dist/`.

Tasks:

- Confirm `npm run build` emits `dist/manifest.json` with rewritten paths and `dist/extension/src/background/index.js`. If not, fix the `crxjs` config so the source `manifest.json` carries the `.ts` paths and the plugin rewrites them — already designed for this.
- Document in `README.md` that the user must load `dist/`, never the repo root.
- Delete the legacy `extension/background.js` and `extension/content.js` if they are no longer wired anywhere (verify with `grep`). They confused Phase 0.

### E.2 Optional host permissions block detection silently

Manifest has `"host_permissions": []` and `"optional_host_permissions": ["<all_urls>"]`. The webRequest listeners require host permission for the URL pattern — they will register but never fire on origins the user hasn't approved.

Tasks:

- On first install, show a one-time popup card explaining the permission tradeoff and offering a single button to request `<all_urls>` (or per-origin on demand — already wired).
- In the popup status footer, when host permission is missing for the current tab's origin, show **Grant access to <origin>** as a CTA that calls `chrome.permissions.request`.
- Add a permissions status section to the options page listing every granted origin with a Revoke button.

### E.3 Service worker progress polling spams the host

`background.ts` runs `setInterval(..., 1000)` issuing a `download.getProgress` per active download. The host already pushes `download.progressUpdate` every 500 ms — polling on top of that is redundant and keeps the SW alive unnecessarily (defeats MV3 idle-eviction).

Tasks:

- Drop the polling interval entirely. Trust the host's push.
- If the SW is woken with no recent push, send a single `download.list` to repopulate state instead of per-id polling.

### E.4 Filename collisions clobber existing downloads

`resolveDownloadTarget` puts every download in the same directory with the same filename. Two downloads from URLs ending in `setup.exe` will write to the same file.

Tasks:

- In `engine.go: resolveDownloadTarget`, when `<dir>/<name>` exists, append ` (2)`, ` (3)`, … before the extension. Hold an in-process lock so two simultaneous adds don't race.
- For resume, allow the file to exist if its `DownloadState.ID` is the one resuming.

### E.5 Cookie collection often empty

`getCookiesForUrl` calls `cookies.getAll({ url })` which requires `cookies` permission AND host permission for the URL. With `<all_urls>` optional, this fails silently (caught by try/catch). The download then goes to the host without auth and 403s on most authenticated CDNs.

Tasks:

- Before calling `interceptDownload`, ensure origin permission (already done) AND log when cookies array is empty unexpectedly.
- Surface "0 cookies forwarded" in the new host log so debugging auth failures is possible.

### E.6 Probe ignores caller cancellation

`probeDownload` calls `doRequestWithRedirects(context.Background(), …)`. If the user removes the download or the daemon shuts down during probe, the HTTP request lingers.

Tasks:

- Thread a context from `engine.Add` (which itself should accept a context — refactor the IPC handler in `main.go` to spawn `context.WithCancel` per request and cancel it when the user issues `download.pause` before the download starts).

### E.7 Daemon shutdown does not flush state

`main.go` exits the read loop on EOF (browser closing the port). Active downloads are not gracefully canceled; the next startup's `PauseActiveDownloads` only handles status=="downloading" but does not flush in-flight segment offsets.

Tasks:

- Wrap the main read loop in a signal handler (`signal.Notify(SIGINT, SIGTERM)`).
- On shutdown: cancel every active download's context, wait up to 5 s for goroutines to drain (use a `sync.WaitGroup` in `Engine`), then `storage.db.Close()`.
- Ensure each segment's `Current` is persisted before exit (currently persisted on every 500 ms tick — add a final flush in `runDownload` and `runVideoDownload` defer blocks).

### E.8 Resume after error doesn't reset retry counter

`engine.go: downloadSegment` uses a local `attempt` loop bounded by `maxSegmentRetries`. On Pause+Resume the loop restarts from 0 — correct. But on `Resume` after `error`, segment state still has whatever `Current` it had; if the byte was corrupt, the resume hash will fail. Add a check: when status was `error` AND a `ContentMD5`/`Digest` was set, discard `Current` for incomplete segments and re-download from scratch.

### E.9 `cancelScheduler` never called on exit

`main.go:67` defers `cancelScheduler` but the read loop is the only blocker; `break`-ing out of it falls through to deferred. Fine. But the scheduler goroutine itself may be in a long `time.Sleep`. Change `scheduler.go` to use `time.NewTimer` + `select` on `ctx.Done()` (verify it already does — `scheduler.go:Start`).

### E.10 Throttle when value changes mid-flight

`UpdateHostSettings` replaces `PerDownloadLimiter` on each `ActiveDownload`, but the `throttledReader` instances created per HTTP response still hold the OLD limiter pointer. Bytes mid-flight keep using the old cap.

Tasks:

- `throttledReader` should re-fetch the limiter from the `*ActiveDownload` on each `Read`, OR engine should signal active readers to refresh.
- Simpler: store the limiter as `atomic.Pointer[rate.Limiter]` on `ActiveDownload`; readers `Load()` each call.

### E.11 Speed string parsing is ambiguous

`main.go: parseSpeedBytes` parses `"1.2 KB/s"` into bytes. But `formatSpeed` uses SI letters (`%cB/s` with `"KMGTPE"`) — that emits `KB/s` for 1024, not 1000. Parsing matches because the multiplier table is also 1024-based. Fine, but document the inconsistency (decimal SI prefix, binary value). Better: have `DownloadState.SpeedBytesPerSecond int64` carry the raw number and let the UI format. Drop the string-based round-trip entirely.

### E.12 Remove decorative "Source Code" sidebar entry or wire it

`App.tsx:1085` — `SidebarItem` with `icon={Github}` does nothing. Either give it an `onClick` opening the repo URL or remove the row. Hidden CTAs erode trust.

### E.13 No empty-state for queue

When `downloads` is `[]`, the table renders nothing — visually broken on first load. Add an empty state with a CTA to **Add URL** and a hint that downloads from the browser will appear here automatically.

### E.14 Add-URL modal accepts any string

`addDownload` only checks `!urlInput`. Invalid URLs are forwarded to the host which fails the probe and shows an error. Validate client-side with `new URL(input)` and disable the submit button until valid.

### E.15 `Resume All` re-queues already-active downloads

`download.resumeAll` in `main.go` calls `engine.Resume` for every download whose status is `paused` or `queued`. For `queued` items already in the in-process queue, `Start` re-enqueues — guarded by `queuedSet`, OK. But for status `paused` whose ID is still in `e.active` because Pause raced with Resume, `Start` returns "already active" and the function swallows it (`err.Error() != "already active"`). Add a unit test for this race (`engine_queue_test.go` is the right place).

---

## Phase F — Cross-cutting cleanups

- Update `BUILD_PLAN.md` Phase 3.3: typo fix already shipped (`Active Queue` correct in `App.tsx:1076`). Mark it ☑.
- Update the `Current state` snapshot at the top of `BUILD_PLAN.md` to reflect Phase 0 ☑, Phase 1 ☑/◐, etc., based on what landed since 2026-05-19.
- Add `make logs` / `npm run logs` shortcut that tails the structured log file.

---

## Suggested order

1. **Phase A** (logging) — 1 day. Unblocks every subsequent debug session.
2. **Phase B.1, B.2** (download dir + path display) — 1 day. High user impact, low complexity.
3. **Phase D** (delete UX) — half a day.
4. **Phase B.3, B.4** (open/reveal/picker) — 1 day.
5. **Phase C** (video grabber) — 2–3 days. C.1 and C.2 are the meaty ones; C.3 is a nice-to-have escape hatch.
6. **Phase E.1, E.2** (manifest paths + permission UX) — 1 day. Blocks new users from getting the extension to work at all.
7. **Phase E.3–E.15** in priority order as time permits.

Total: ~1.5 weeks focused work.

---

## Smoke tests for the whole plan

A reviewer or tester runs these end-to-end after Phase A–E:

- [ ] Fresh install → first browser action click shows the permission CTA.
- [ ] Configure a custom download dir on an external drive; download a 500 MB file; open the file from the row; reveal it in the OS file manager.
- [ ] Open an HLS demo page; overlay shows variants; choose 720p; download completes; muxed MP4 plays.
- [ ] Pause / Resume / Remove (keep file) / Remove (delete file) all behave per Phase D.
- [ ] Force a 403 by clearing cookies for an authenticated CDN; error shows status code, log entry has full URL and headers.
- [ ] Kill the daemon mid-download; reopen browser; downloads show `paused`; click resume; file SHA-256 matches a reference.
- [ ] On YouTube, no overlay (DRM refusal) or a clearly-worded refusal banner.
