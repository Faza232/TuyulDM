# TuyulDM — Build Plan 3 (IDM-Class Reliability & Speed)

Follow-up to `BUILD_PLAN_2.md`. Goal: turn the current single-pass segmented downloader into something that survives the messy real world the way IDM does — flaky CDNs, signed URLs that expire mid-download, slow segments dragging the whole job, and resumes that don't quietly corrupt the output.

Reference research lives in the session that produced this plan; sources cited inline per phase. Phases ordered by impact-per-day. Each task lists files to touch, acceptance, and a smoke test.

Status legend: ☐ todo · ◐ partial · ☑ done.

Assumes Phase A of `BUILD_PLAN_2.md` (structured logging) is in place — every new code path here is expected to emit `slog` events with `download_id`, `segment_index`, `attempt`, `event`.

---

## Phase G — Resource validators (foundation)

Without ETag / Last-Modified / Content-Length captured at probe time, every later resilience feature (URL refresh, safe resume, integrity check) is guessing. This phase is small but blocks the rest.

### G.1 Capture validators during probe

Files: `native-host/engine.go` (`downloadMetadata`, `metadataFromResponse`, `probeDownload`).

Tasks:

- Extend `downloadMetadata`:
  ```go
  type downloadMetadata struct {
      FinalURL     string
      TotalSize    int64
      AcceptRanges bool
      ContentMD5   string
      Digest       string
      ETag         string    // new — raw header value, including weak prefix W/
      LastModified string    // new — raw RFC 1123 string
  }
  ```
- `metadataFromResponse` reads `ETag` and `Last-Modified` headers verbatim. Do not parse the date — preserve byte-for-byte so the `If-Range` echo always matches what the server gave us.
- Probe must run a `GET` with `Range: bytes=0-0` (already done as fallback) when HEAD lacks both validators. Many CDNs strip ETag from HEAD but keep it on GET.

### G.2 Persist validators in `DownloadState`

Files: `native-host/protocol.go` (or wherever `DownloadState` lives), `native-host/storage.go` (schema migration if any).

Tasks:

- Add fields to `DownloadState`:
  ```go
  ETag           string    `json:"etag,omitempty"`
  LastModified   string    `json:"lastModified,omitempty"`
  TotalSizeAtAdd int64     `json:"totalSizeAtAdd,omitempty"` // snapshot for refresh-URL parity check
  ProbedAt       time.Time `json:"probedAt,omitempty"`
  ```
- `engine.Add` writes them after probe; never overwritten by later writes.
- bbolt schema is JSON, so no migration needed — old records read with zero values, which all subsequent code must treat as "unknown validator, fall back to size-only checks."

Acceptance:
- After adding a download, `bbolt` row contains the ETag exactly as the server sent it.
- A download whose server omits both validators still succeeds, with `state.ETag == "" && state.LastModified == ""` and a single warning log line `validators_missing`.

---

## Phase H — Safe resume with `If-Range`

Today every segment resume sends a bare `Range:` header. If the file changed on the server (CDN rotated a version, signed URL points to a different rendition), the resume silently glues new bytes onto old bytes and the final file is corrupt.

### H.1 Conditional resume

Files: `native-host/engine.go: downloadSegmentAttempt`.

Tasks:

- When `seg.Current > 0` (resume case) and `state.ETag != ""` OR `state.LastModified != ""`, attach:
  ```
  If-Range: <state.ETag or state.LastModified>
  ```
  Prefer ETag; if absent use Last-Modified. Never send both.
- After response:
  - `206 Partial Content` → behave as today, append from `Current`.
  - `200 OK` → server is sending the whole file from byte 0 because the validator no longer matches. Two valid responses:
    1. **Restart this segment from offset 0**, keep going. Other segments may also be stale — escalate (see H.2).
    2. If `Content-Length` differs from `state.TotalSize`, the file changed size — abort all segments, mark `state.Status = "error"`, `ErrorCode = "remote_changed"`, prompt user (see Phase J).
  - `416 Range Not Satisfiable` → segment offset is past EOF. Reset `seg.Current = 0`, retry once; if still 416, surface `range_unsupported`.

### H.2 Full-download integrity check on resume

When ANY segment trips the `200 OK` branch during resume, the whole file's bytes-before-`Current` are suspect.

Tasks:

- Add `Engine.invalidateAllProgressOnRemoteChange(a)`:
  1. Cancel all in-flight segments.
  2. Zero every segment's `Current` and `Completed`.
  3. `os.Remove(state.OutputPath)` if non-zero file exists.
  4. Re-probe URL fresh; update validators in `state`.
  5. Restart segments from scratch.
- Triggered only when `If-Range` validator disagreement is detected — never on plain `200 OK` from a server that ignores `Range` entirely (in which case `AcceptRanges` was already false, so we never had segments > 1 anyway).
- Log every step at `warn` with `event=remote_changed_recovery`.

Sources (research feeding this phase):
- [HTTP If-Range (MDN)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/If-Range)
- [HTTP Range Requests (MDN)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests)
- [Resumable Downloads deep-dive (kean.blog)](https://kean.blog/post/resumable-downloads)

Acceptance:
- Pause a download, alter the file on a local test server (change one byte), resume → file is fully redownloaded, log line `remote_changed_recovery` is present, final file matches the NEW reference SHA-256.
- Pause a download, restart server unchanged, resume → all segments send `If-Range`, all get `206`, completes normally with one log line per segment confirming `if_range_matched=true`.

---

## Phase I — Per-segment retry with exponential backoff

`maxSegmentRetries = 5` exists, but retries fire back-to-back. A server returning 503 under load gets hammered, gets us rate-limited, and the user sees `exhausted retries` 50 ms after the first try.

### I.1 Backoff policy

Files: `native-host/engine.go: downloadSegment`, new `native-host/backoff.go`.

Tasks:

- New helper:
  ```go
  // backoffDelay returns the wait before the Nth retry (0-indexed).
  // 1s, 2s, 4s, 8s, 16s, capped at 30s, with ±20% jitter.
  func backoffDelay(attempt int) time.Duration
  ```
- `downloadSegment` between attempts: `select { case <-time.After(backoffDelay(attempt)): case <-a.Context.Done(): return ctx.Err() }`.
- Honor `Retry-After` header on `429` and `503`:
  - If integer seconds → use that value, clamped to [1s, 5m].
  - If HTTP-date → compute delay.
  - Falls back to `backoffDelay(attempt)` if header absent / malformed.
- Distinguish retryable vs fatal:
  - Retryable: network errors, `408`, `425`, `429`, `500`, `502`, `503`, `504`, TLS handshake timeout.
  - Fatal (no retry, surface immediately): `400`, `401`, `403`, `404`, `410`, `451`. These usually mean URL expired or auth broke — route to Phase J refresh flow instead of burning retries.
- Log every retry with `event=segment_retry`, `attempt`, `delay_ms`, `retryable_status` or `network_error`.

### I.2 Stalled-segment detector

Files: `native-host/engine.go: downloadSegmentAttempt`, `native-host/throttle.go`.

A connection can sit in `Read` returning 0 bytes for minutes before the OS gives up. Detect and kill it.

Tasks:

- Wrap the segment's `io.Reader` in a stall watchdog:
  - Track last-progress time.
  - Background ticker (5 s) checks `now - lastProgress`.
  - If > 30 s of zero progress with no error, cancel the segment's request via its `context.CancelFunc`, surface as a synthetic `network_stall` error, fall through to retry.
- Configurable `HostSettings.SegmentStallTimeoutSec` (default 30, min 5, max 600).

Acceptance:
- Test server that stops sending bytes mid-segment → segment cancels at ~30 s, retries, succeeds when server resumes.
- `429` with `Retry-After: 5` → segment waits ~5 s before retry, log shows `retry_after_ms=5000`.
- `404` → no retry, immediate `Status=error`, `ErrorCode=fatal_http_404`.

---

## Phase J — Dynamic URL refresh (the IDM party trick)

Signed URLs (S3 presign, Drive, OneDrive, Cloudflare R2 with signed cookies) expire on the clock, not on completion. User reloads the source page, gets a new URL pointing to the same file, and expects the download to keep its progress.

### J.1 Expiry detection

Files: `native-host/engine.go: downloadSegmentAttempt` (response classification).

Tasks:

- When a segment in flight gets `401`, `403`, `410`, or a redirect to a login/error page (`Content-Type: text/html` from an asset URL is a strong signal), classify as `url_expired` instead of `fatal_http_*`.
- Pause all segments of that download (cancel their contexts, persist `Current`).
- Set `state.Status = "awaiting_url_refresh"`, `state.ErrorCode = "url_expired"`.
- Broadcast `PROGRESS_UPDATE` with the new status. Background → UI surfaces it.

### J.2 Refresh endpoint

New IPC method: `download.refreshUrl { id, url }`.

Files: `native-host/main.go` (dispatch), `native-host/engine.go: RefreshURL`.

Tasks:

- `Engine.RefreshURL(id, newURL string) error`:
  1. Load `state`. Refuse unless `Status` is `awaiting_url_refresh`, `paused`, or `error` with `ErrorCode=url_expired`.
  2. Re-probe `newURL` with the original headers/cookies. Get fresh `downloadMetadata`.
  3. Parity checks (in order, fail loud on first mismatch):
     - `meta.TotalSize == state.TotalSizeAtAdd` — must match exactly. Mismatch → return `size_mismatch`, leave state unchanged.
     - `meta.AcceptRanges == true` — required to resume.
     - If both old `state.ETag` and new `meta.ETag` present: must be equal. Mismatch → return `etag_mismatch` with both values in the error payload; UI can then ask "different file — restart from scratch?".
     - If only Last-Modified present on both sides: must be equal.
     - If new side has zero validators: warn, allow if user confirms with `force: true` (UI flag).
  4. On pass: rewrite `state.URL = newURL`, refresh `state.ETag`, `state.LastModified`, `state.FinalURL`. Keep all segment `Current` offsets.
  5. `engine.Resume(id)` to relaunch segments — they will use the new URL via the updated `state.URL` and `If-Range` validates the resumed bytes.

- Optional flag `download.refreshUrl { id, url, force: bool }` to bypass validator mismatch when the user is willing to gamble. Logs `event=url_refresh_forced` at `warn`.

### J.3 UI flow

Files: `src/App.tsx`, `extension/src/background/index.ts`, `popup.html`.

Tasks:

- Row in `awaiting_url_refresh` state renders a yellow banner: **Link expired. Refresh URL to keep your progress.**
- Button **Refresh Link** opens a modal:
  - Input: new URL.
  - Helper text: "Paste the new download link from the source page. Your downloaded bytes will be reused."
  - Submit calls `REFRESH_DOWNLOAD_URL { id, url }`.
- Background message handler issues `download.refreshUrl` to host.
- On `size_mismatch` or `etag_mismatch`, modal renders the mismatch detail and offers two buttons: **Cancel** and **Restart from scratch (delete progress)**. The second calls `download.refreshUrl` with `force: true` AND deletes `OutputPath` + zeros segments first.
- Browser-action shortcut: right-click a download row in the popup → "Refresh URL from current tab" pulls the active tab's URL automatically.

Sources:
- [IDM Refresh Download Address FAQ](https://www.internetdownloadmanager.com/register/new_faq/sites2_3.html)
- [IDM Refresh Expired Link walkthrough](https://mindxmaster.com/powerful-way-to-resume-brokenexpired/)

Acceptance:
- Generate a 5-minute S3 presigned URL, start a slow download (throttle to 100 KB/s), wait for URL to 403, observe `awaiting_url_refresh`. Generate a new presign for the same object, paste, submit → download resumes from current offset, completes, file SHA-256 matches.
- Same flow with a presign of a DIFFERENT object (same size) → ETag mismatch surfaces in modal; "Restart from scratch" rebuilds the file; "Cancel" leaves state untouched.

---

## Phase K — Dynamic segmentation (work stealing)

`buildSegments` divides the file into N equal slices at the start and never reconsiders. When one segment runs against a slow mirror or a flaky route, the whole download stalls on that one worker even though seven others are idle.

This is the IDM "dynamic segmentation" feature: idle workers steal work from busy ones.

### K.1 Steal protocol

Files: `native-host/engine.go: runDownload` (worker loop), new method `Engine.stealWorkFor(a *ActiveDownload, idleIdx int)`.

Tasks:

- When `downloadSegment` returns successfully (`completeSegment` ran), the worker does NOT exit. Instead it asks the engine for more work:
  ```go
  func (e *Engine) stealWorkFor(a *ActiveDownload, idleIdx int) (newSegment *Segment, ok bool)
  ```
- Implementation:
  1. Under `a.mu`, scan all segments.
  2. Pick the segment with the largest remaining bytes (`seg.End - seg.Current + 1`).
  3. If the largest remaining is below a threshold (e.g. `4 * 1024 * 1024` = 4 MB), return `ok=false` — not worth the overhead of a fresh TCP request.
  4. Otherwise, split the victim's remaining range in half:
     - Truncate victim's `End` to the midpoint.
     - Create a new segment at index `len(state.Segments)` with `Start = midpoint + 1`, `End = oldEnd`, `Current = Start`.
     - The victim's in-flight HTTP request continues unchanged because its `Range` header was set at request time; when its `Current` reaches its new `End`, it stops naturally.
  5. Persist the new segment array. Return the new segment to the idle worker.
- Idle worker reuses its existing `http.Client` (connection pooling — see Phase L) and issues `GET` with the new Range.

### K.2 Bounded splits

- Cap total segments at 32 per download (configurable `HostSettings.MaxSegmentsPerDownload`).
- After each split, log `event=segment_split` with `from_index`, `from_remaining`, `new_index`, `new_size`.

Sources:
- [IDM dynamic segmentation overview](https://www.internetdownloadmanager.com/)
- [aria2 segment merging discussion](https://github.com/aria2/aria2/issues/1751)

Acceptance:
- Server that throttles one of eight concurrent connections to 10 KB/s while others run at full speed → after the first fast worker finishes, the slow one gets its remaining range halved by a stealer; total wall-clock is dominated by the fast workers, not the slow one.
- File integrity check post-download (Phase H reuses `verifyDownloadIntegrity`) passes.

---

## Phase L — Connection reuse and pre-allocation

Two cheap wins that compound the gains from K.

### L.1 Per-download HTTP client with connection pool

Files: `native-host/engine.go: newHTTPClient`, `ActiveDownload`.

Tasks:

- Today every segment call to `newHTTPClient` builds a fresh `*http.Client` with a fresh `Transport` — every segment opens a new TCP+TLS handshake.
- Move client construction into `engine.Add` so each `ActiveDownload` owns ONE `*http.Client` shared by all its segments.
- Tune transport:
  ```go
  Transport: &http.Transport{
      Proxy:               http.ProxyFromEnvironment,
      MaxIdleConns:        64,
      MaxIdleConnsPerHost: 32,
      MaxConnsPerHost:     32,
      IdleConnTimeout:     90 * time.Second,
      ForceAttemptHTTP2:   true,
      DisableCompression:  true, // we want raw bytes for range math
  }
  ```
- Cookie jar is per-download (already correct since cookies are per-URL).
- Log `event=transport_reused` with `idle_conns` on each segment start so we can confirm keep-alive is working.

### L.2 Sparse pre-allocation of the output file

Files: `native-host/engine.go: completeSegment` / segment open path.

Tasks:

- On first segment open for a download, `os.OpenFile(OutputPath, O_RDWR|O_CREATE, 0644)` then `f.Truncate(state.TotalSize)` (only when `TotalSize > 0`). This:
  - Reserves disk up front — `ENOSPC` shows up at the start, not at 99%.
  - Makes the file sparse on ext4/xfs/APFS/NTFS — no zero-fill cost.
- Each worker uses `f.WriteAt(buf, offset)` instead of `Write` after `Seek`. Avoids the file-position race already lurking in the code.
- Skip pre-allocation when `TotalSize <= 0` (unknown length) — fall back to current single-segment streaming.

Sources:
- [Connection pooling rationale (Apache HttpClient)](https://www.baeldung.com/httpclient-connection-management)
- [Download manager segmentation patterns (Grokipedia)](https://grokipedia.com/page/Download_manager)

Acceptance:
- A 4 GB download on a near-full disk fails at probe time with `disk_full`, not at 95% completion.
- Wireshark trace of an 8-segment download shows at most a handful of TCP handshakes for the whole download, not 8+.

---

## Phase M — Integrity verification

`verifyDownloadIntegrity` exists but only checks `ContentMD5` / `Digest` headers, which most CDNs do not send.

### M.1 Optional whole-file hash after completion

Files: `native-host/engine.go: verifyDownloadIntegrity`.

Tasks:

- After all segments complete, if `state.ContentMD5 != "" || state.Digest != ""`:
  - SHA-256/MD5 the file on disk (streaming, 4 MB chunks).
  - Compare to header value.
  - Mismatch → mark `state.Status = "error"`, `ErrorCode = "integrity_failed"`, keep file but rename to `<name>.corrupt` so user can decide.
- If neither header is set, skip but log `event=integrity_skipped`.
- Setting `HostSettings.VerifyIntegrity` (default `true`) lets user disable for huge downloads where the hash cost matters.

### M.2 Cheap per-segment sanity

Tasks:

- After each segment completes, assert `seg.Current == seg.End + 1` exactly (or `seg.Current > 0` for unknown-length last segment). Mismatch → `state.Error = "segment_size_mismatch"`, surface immediately.

Acceptance:
- A test server that flips one byte mid-download (intercepting a range response) → integrity check fails post-download, file is renamed `.corrupt`, log entry has `expected=<hex>` and `actual=<hex>`.

---

## Phase N — Cancellation propagation

Phase E.6 in `BUILD_PLAN_2.md` flagged that `probeDownload` ignores caller cancellation. This phase finishes the thread.

Tasks:

- Every public `Engine` mutator (`Add`, `Pause`, `Resume`, `Remove`, `RefreshURL`) takes `ctx context.Context` as first arg.
- IPC dispatch in `main.go` constructs a per-request `ctx` derived from a daemon-level context. Cancelled on `download.pause` and `download.remove` even if the request was still in `probeDownload`.
- `runDownload` and `runVideoDownload` derive a per-download cancellable context stored on `ActiveDownload`. `Pause`/`Remove` cancel it directly instead of polling.

Acceptance:
- Issue `download.add` then `download.remove` within 100 ms → probe HTTP request is cancelled (verify via test HTTP server that logs received then aborted).

---

## Phase O — Video grabber that actually grabs (IDM-class detection)

Phase C of `BUILD_PLAN_2.md` patches the existing overlay. This phase rebuilds detection so it works on the messy real sites IDM handles — generic HLS/DASH players, MSE-driven players with `blob:` URLs, and the small set of sites (YouTube being the loud example) where the manifest URL is gated by a JS signature cipher and no network sniffer alone will get a playable URL.

### O.1 Hook the page itself — MAIN-world instrumentation

Sniffing `webRequest` alone misses every player that uses MSE: those send `blob:` URLs to the `<video>` element while pulling fragments via `fetch` inside a worker, often relative to a manifest the extension never saw resolved. IDM works around this by instrumenting the page; we should too.

Files: new `extension/src/content/page_hook.ts` (compiled to a script that runs in the **MAIN** world), `extension/src/content/index.ts` (ISOLATED world bridge), `extension/manifest.json`.

Tasks:

- Register a content script with `world: "MAIN"` at `document_start`:
  ```ts
  chrome.scripting.registerContentScripts([{
    id: "tuyul-page-hook",
    matches: ["<all_urls>"],
    js: ["page_hook.js"],
    runAt: "document_start",
    world: "MAIN",
    allFrames: true,
  }]);
  ```
- `page_hook.ts` patches in this order, all wrapped to be installation-idempotent:
  1. `window.fetch` — pass through, but `postMessage` the request URL, method, response status, `content-type` to the ISOLATED world for every request whose URL matches a media regex (see O.2).
  2. `XMLHttpRequest.prototype.open` and `.send` — same as above; capture both `.responseURL` (after redirects) and the response headers via `getAllResponseHeaders()`.
  3. `MediaSource.prototype.addSourceBuffer` — wrap; capture the MIME type string passed in (`video/mp4; codecs="avc1.64001f"` etc.). Combined with whatever URL the page just fetched, this confirms the segment format.
  4. `URL.createObjectURL` — when called with a `MediaSource`, record the returned `blob:` URL and tie it back to the most recent video-looking fetch chain.
  5. `HTMLMediaElement.prototype.src` setter — record the URL/blob assigned. Mark the element with a `data-tuyul-id` attribute (UUID) so the ISOLATED-world content script can find it.
- Bridge events to the ISOLATED world via `window.postMessage({ type: "TUYUL_PAGE_HOOK", payload: ... }, "*")`. ISOLATED-world content script forwards via `chrome.runtime.sendMessage` to the background.
- All event payloads include `frameUrl`, `tabId` (filled by background from `sender`), and a monotonic counter. No DOM references cross the worlds — only strings.

Note on YouTube specifically: this hook captures the adaptive manifest URLs YouTube fetches (`/videoplayback?...&sig=...`), but the URLs are already signed with the deciphered `sig` and `n` parameters by the time they reach `fetch` — the YouTube player has already run its JS to produce them. So MSE hooking sidesteps the signature problem entirely **as long as the user is actually playing the video in the tab**. That is the IDM model: it grabs what the player asked for. No JS interpreter needed unless we want to download without playing first (see O.5).

### O.2 Media URL classifier

A central regex-and-MIME classifier the hook + webRequest pipeline both use.

Files: new `extension/src/shared/media_classify.ts`.

Tasks:

- Classify a `{ url, contentType, mimeFromMSE?, sizeHint? }` as one of:
  - `manifest_hls` — `.m3u8` extension OR `application/vnd.apple.mpegurl` / `application/x-mpegurl` content type.
  - `manifest_dash` — `.mpd` OR `application/dash+xml`.
  - `segment_hls` — `.ts`, `.aac`, `.m4s`, `.mp4` content fetched with `Range:` from an origin that already produced an HLS manifest in this tab.
  - `segment_dash` — `.m4s` / `.mp4` fetched after an MPD.
  - `progressive_mp4` — direct `.mp4`/`.webm` with `Content-Length` and `Accept-Ranges: bytes`, no manifest precedent.
  - `unknown` — everything else; drop.
- Dedupe by URL within a (tabId, top-frame-URL) window.
- When a segment shows up before its manifest, hold it in a 30-second buffer and re-classify when a manifest URL with matching origin arrives.

### O.3 Per-tab detection state + popup surface

Replaces the current "inject overlay 30 s after first detection" flow.

Files: `extension/src/background/index.ts`, `popup.html` + new `extension/src/popup/main.tsx`.

Tasks:

- Background maintains `Map<tabId, DetectedMedia[]>` cleared on `tabs.onRemoved` and `webNavigation.onCommitted`.
- Each entry: `{ id, url, kind, label, sizeHint, qualities?: VariantInfo[], pageUrl, detectedAt }`.
- For HLS/DASH manifests, background eagerly fetches the manifest with the same cookies/headers (via `chrome.cookies` + the originating tab's URL) and parses variants. Reuse `native-host/hls.go: parseMasterPlaylist` and `parseMediaPlaylist` — expose them via a new IPC `host.parseManifest { url, headers, cookies }` so we don't reimplement parsing in TS.
- Browser action badge: shows count of detected media on current tab; default off when zero so it stays out of the way.
- Popup → **Detected Media** tab lists all entries with thumbnail (if `videoElement.poster` was captured), quality selector for HLS/DASH variants, **Download** button.
- Replace the auto-inject overlay with an optional setting `Show overlay on detect` (default off after the user feedback that auto-overlays are intrusive — Phase C.1 in BUILD_PLAN_2 already bumps timeout, this just makes opt-in the default).

### O.4 Page action — "Scan this page now"

Power-user escape hatch when MAIN-world hook missed something (some sites lazy-load the player via shadow DOM after user interaction).

Files: `extension/src/popup/main.tsx`, `extension/src/content/index.ts`.

Tasks:

- Popup button **Scan Page** sends `SCAN_PAGE` to the active tab's content script.
- Content script:
  1. Re-runs `performance.getEntriesByType("resource")` and classifies every URL.
  2. Walks every `<video>`, `<audio>`, `<source>` in all `Shadow Roots` it can find (`document.querySelectorAll("*")` + recursive `shadowRoot` walk).
  3. Walks every `<iframe>` and recursively asks each frame's content script the same.
  4. Returns the aggregated list.
- Popup merges results into its `DetectedMedia` view.

### O.5 Optional: site-specific extractors (the YouTube tier)

For sites where playing the video to capture the manifest is unacceptable UX, or where signature ciphers / token shuffles run client-side without playback (e.g. Twitch VODs, paywalled live streams, some news sites), we need extractor modules.

This is the yt-dlp model. Reimplementing yt-dlp is out of scope. Two pragmatic options:

**Option A — Bundle yt-dlp as a sidecar binary.**
- Native host invokes `yt-dlp --dump-single-json --no-warnings <url>` when the URL matches a known extractor pattern.
- yt-dlp returns the resolved formats; we feed the chosen format's `url` (and `http_headers`) into the existing engine.
- For DASH adaptive formats (separate audio + video tracks), reuse the existing ffmpeg mux pipeline from `native-host/ffmpeg.go`.
- yt-dlp auto-updates: add a `tools.updateYtDlp` IPC that runs `yt-dlp -U` on demand and surfaces output to a Settings → Tools panel.
- License/distribution: yt-dlp is Unlicense / public-domain-equivalent. Bundling is fine. Document this in `README.md`.

**Option B — In-process JS signature decipher (long term, not now).**
- Mirror yt-dlp's `jsinterp.py` approach: download YouTube's player JS, walk the AST for the sig + n functions, port them to Go using `github.com/dop251/goja`.
- High maintenance — YouTube changes the player roughly weekly.
- Recommended only if Option A becomes politically untenable (e.g. user wants no Python on their machine).

**Recommendation: ship Option A** in this phase. Add a `Tools` section to the Settings panel exposing yt-dlp version + an Update button. Auto-detect yt-dlp on `PATH`; if absent, prompt the user with a platform-specific install hint (don't auto-install).

When the user clicks **Download** on a yt-dlp-extracted result, the host pipeline is identical to a normal multi-segment HTTP download — yt-dlp is purely a URL-resolution layer.

Sources:
- [yt-dlp JavaScript Interpreter — DeepWiki](https://deepwiki.com/yt-dlp/yt-dlp/5.4-javascript-interpreter)
- [yt-dlp project](https://github.com/yt-dlp/yt-dlp)
- [Diary of youtube-dl internals — DEV](https://dev.to/zenulabidin/diary-of-youtube-dl-internals-part-4-58ga)

### O.6 DRM detection and user-facing refusal

Already partially handled in Phase C.5 of `BUILD_PLAN_2.md`. Tighten:

Files: `native-host/hls.go`, `native-host/video_manifest.go`.

Tasks:

- HLS: if manifest contains `#EXT-X-KEY:METHOD=` with anything other than `NONE` or `AES-128` with a fetchable plaintext key URL whose origin is allowed, mark `Protected = true`.
- DASH: any `ContentProtection` element with `schemeIdUri` other than `urn:mpeg:dash:mp4protection:2011` (which is just signaling, not encryption) → `Protected = true`.
- For YouTube specifically: even when the manifest itself isn't DRM, certain video IDs are Widevine-protected. yt-dlp surfaces this in its JSON as `_has_drm: true` — propagate that field into the host response.
- UI: protected media in the detected list renders dimmed with a small lock icon and tooltip "Encrypted (DRM) — TuyulDM does not bypass DRM."

### O.7 Detection footprint and anti-anti-download

IDM marks video elements with `__idm_id__`; sites detect that attribute and block playback. Don't repeat their mistake.

Tasks:

- Never set DOM attributes on the host page's elements. Track our state in a `WeakMap<HTMLMediaElement, TuyulMediaInfo>` inside the content script.
- The bridge UUID lives on a per-script `Map`, never serialized to the DOM.

Sources feeding this phase:
- [How IDM grabs video URL — Quora](https://www.quora.com/How-does-Internet-Download-Manager-grab-the-URL-of-online-videos)
- [IDM Video Grabber FAQ](https://www.internetdownloadmanager.com/register/new_faq/functions20.html)
- [IDM Streaming Video FAQ](https://www.internetdownloadmanager.com/register/new_faq/video5.html)
- [IDM video panel missing — vendor FAQ](https://www.internetdownloadmanager.com/register/new_faq/video11.html)
- [Blocking IDM via `__idm_id__` attribute](https://dev.to/kareem-khaled/blocking-idm-downloads-a-tactical-guide-to-protecting-your-video-content-on-website-3ilo)
- [MediaSource API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API)
- [MSE spec — W3C](https://www.w3.org/TR/media-source-2/)
- [media-bridge extension (reference impl, HLS/DASH MSE detection)](https://github.com/jvillegasd/media-bridge)
- [M3U8 stream downloader extension (reference impl, multi-source detection)](https://github.com/needyamin/M3U8-Stream-Downloader-Browser-Extension)

Acceptance:
- Big Buck Bunny HLS demo (Mux test stream) → detected without playback, master + media playlist variants enumerated, download completes, MP4 plays.
- A site using MSE with blob: URL (any major news site player) → at least the manifest URL appears in Detected Media within 2 s of pressing play.
- YouTube non-DRM short video (Creative Commons sample) → detected via yt-dlp path, 1080p available, downloads and muxes audio+video.
- YouTube Widevine-protected video → renders in list as dimmed/locked with DRM tooltip; **Download** button disabled.
- Twitch live stream (HLS, not DRM-protected) → manifest detected; download yields VOD-style segmented MP4.
- Page that scripts `document.querySelector("video[__idm_id__]")` as an anti-IDM canary → our extension is undetected (the attribute is never set).

---

## Suggested order

1. **Phase G** (validators) — half a day. Pure data plumbing, nothing else works without it.
2. **Phase H** (safe resume) — 1 day. Eliminates silent corruption.
3. **Phase I** (backoff) — half a day. Stops the hammering, makes logs readable.
4. **Phase J** (URL refresh) — 1.5 days. The big user-facing feature.
5. **Phase L** (connection reuse + pre-alloc) — half a day. Easy speed win.
6. **Phase K** (dynamic segmentation) — 1.5 days. Highest engineering risk; do after L so the pool can absorb the new connections.
7. **Phase M** (integrity) — half a day.
8. **Phase N** (cancellation) — half a day. Touch-up pass after the new control flow is in.
9. **Phase O** (video grabber expansion) — 3–4 days. O.1+O.2+O.3 are the core (~2 days). O.4 is half a day. O.5 (yt-dlp sidecar) is 1 day including settings UI. O.6+O.7 fold into the others.

Total: ~10 working days. Sequence assumes Phase A of `BUILD_PLAN_2.md` (logging) has landed; if not, do that first. Phase O can run in parallel with G–N if a second person is available — they touch disjoint code (`extension/` + small `host` additions vs `native-host/engine.go`).

---

## Smoke tests for the whole plan

Reviewer runs these end-to-end after G–N:

- [ ] **Resume integrity**: pause, mutate one byte on the test origin, resume → file fully redownloaded; log line `remote_changed_recovery` present.
- [ ] **URL refresh happy path**: signed URL expires mid-download; paste new URL for same object; download completes from saved offset; SHA-256 matches reference.
- [ ] **URL refresh mismatch**: paste new URL pointing to a DIFFERENT object of the same size; `etag_mismatch` surfaces in UI; user picks "Restart from scratch"; new file's SHA-256 matches the NEW object.
- [ ] **Dynamic segmentation**: throttle one of eight connections to 10 KB/s on the test origin; observe at least one `segment_split` log line; total time within 1.5× the fast-only baseline.
- [ ] **Backoff**: server returns `503 Retry-After: 5` on one segment; segment waits ~5 s; final file completes; log shows `delay_ms=5000`.
- [ ] **Stall detection**: server stops sending bytes mid-segment; segment cancels at ~30 s; retries with backoff; completes when server resumes.
- [ ] **Pre-allocation**: start a 4 GB download on a disk with 1 GB free; failure at probe with `disk_full`, no partial file on disk.
- [ ] **Connection reuse**: tcpdump shows ≤ 4 TCP handshakes for an 8-segment download on a single-host origin.
- [ ] **Cancellation**: `download.add` followed by `download.remove` within 100 ms cancels the in-flight probe (test origin logs aborted request).
- [ ] **Integrity mismatch**: server flips a byte in a 10 MB range; SHA-256 mismatch is detected post-download; file renamed `<name>.corrupt`; UI shows error code `integrity_failed`.
- [ ] **Video grabber, generic HLS**: open Mux Big Buck Bunny test page; press play; Detected Media surfaces master + variants within 2 s; 1080p download completes; file plays.
- [ ] **Video grabber, MSE/blob**: open a major news site video; press play; manifest URL appears in Detected Media even though network panel only shows `blob:` on the video element.
- [ ] **Video grabber, YouTube non-DRM**: paste a CC-licensed YouTube URL; yt-dlp resolves formats; 1080p downloads with audio+video muxed via ffmpeg.
- [ ] **Video grabber, YouTube DRM**: paste a Widevine-protected video URL; row appears with lock icon and DRM tooltip; Download button disabled.
- [ ] **Video grabber, anti-detect canary**: visit a page running `setInterval(() => document.querySelector("video[__idm_id__]") && block(), 1000)`; playback continues uninterrupted with extension installed and active.

---

## References

- [HTTP Range Requests — MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests)
- [HTTP If-Range — MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/If-Range)
- [HTTP Conditional Requests — MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Conditional_requests)
- [Resumable Downloads — kean.blog](https://kean.blog/post/resumable-downloads)
- [Using HTTP Ranges to Resume — Rick Strahl](https://weblog.west-wind.com/posts/2004/Feb/07/Using-HTTP-Ranges-to-resume-resume-aborted-downloads)
- [Inside the Browser: How Downloads, Temp Files, and Resume Really Work — Gagan Chauhan / Medium](https://medium.com/@GAGGZ/inside-the-browser-how-downloads-temp-files-and-resume-really-work-27b2e20b5c9d)
- [IDM Dynamic Segmentation / Speed Acceleration](https://www.internetdownloadmanager.com/)
- [IDM Refresh Download Address FAQ](https://www.internetdownloadmanager.com/register/new_faq/sites2_3.html)
- [IDM Resume Issues FAQ](https://www.internetdownloadmanager.com/register/new_faq/problems3.html)
- [IDM Refresh Expired Link walkthrough — mindxmaster](https://mindxmaster.com/powerful-way-to-resume-brokenexpired/)
- [aria2 Control File Resume — issue #1500](https://github.com/aria2/aria2/issues/1500)
- [aria2 Segment Merging — issue #1751](https://github.com/aria2/aria2/issues/1751)
- [aria2c manual](https://aria2.github.io/manual/en/html/aria2c.html)
- [Apache HttpClient Connection Management](https://www.baeldung.com/httpclient-connection-management)
- [Download manager overview — Grokipedia](https://grokipedia.com/page/Download_manager)
- [IDM Video Grabber FAQ](https://www.internetdownloadmanager.com/register/new_faq/functions20.html)
- [IDM Streaming Video FAQ](https://www.internetdownloadmanager.com/register/new_faq/video5.html)
- [IDM video panel missing — vendor FAQ](https://www.internetdownloadmanager.com/register/new_faq/video11.html)
- [How IDM grabs video URL — Quora](https://www.quora.com/How-does-Internet-Download-Manager-grab-the-URL-of-online-videos)
- [Blocking IDM via `__idm_id__` attribute — DEV](https://dev.to/kareem-khaled/blocking-idm-downloads-a-tactical-guide-to-protecting-your-video-content-on-website-3ilo)
- [MediaSource API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API)
- [Media Source Extensions — W3C](https://www.w3.org/TR/media-source-2/)
- [yt-dlp project](https://github.com/yt-dlp/yt-dlp)
- [yt-dlp JavaScript Interpreter — DeepWiki](https://deepwiki.com/yt-dlp/yt-dlp/5.4-javascript-interpreter)
- [Diary of youtube-dl internals — DEV](https://dev.to/zenulabidin/diary-of-youtube-dl-internals-part-4-58ga)
- [media-bridge HLS/DASH MSE detector (reference impl)](https://github.com/jvillegasd/media-bridge)
- [M3U8 stream downloader extension (reference impl)](https://github.com/needyamin/M3U8-Stream-Downloader-Browser-Extension)
