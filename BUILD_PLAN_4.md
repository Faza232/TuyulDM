# TuyulDM — Build Plan 4 (Extraction Strategy Matrix)

Follow-up to Phase O of `BUILD_PLAN_3.md`. Goal: stop treating every detected media URL as same kind of job. Today TuyulDM is strongest at **transport** once it already has a direct file URL or a manifest URL. Missing layer is **extraction**: determine how a site exposes media, normalize that into a canonical download plan, then let the engine fetch bytes in parallel.

That missing layer is why YouTube can still degrade into "segments" from the user's point of view. Segments are normal internal transport detail for HLS/DASH. Bug is higher up: TuyulDM can start from raw manifest/fragment observation instead of resolving a full media asset first (single progressive file, HLS rendition, DASH video+audio pair, or site-resolved adaptive plan).

This plan adds that missing layer.

Status legend: ☐ todo · ◐ partial · ☑ done.

---

## Current local gap

- `native-host/video_manifest.go: resolveVideoManifest` accepts direct HLS/DASH manifests and turns them into segment lists. It does not decide **which extraction strategy** should be used for a page or site.
- `extension/src/background/index.ts` can detect media candidates, but detection result still funnels too quickly into `download.video` or `download.add`.
- Adaptive sites are not modeled as first-class "media assets with tracks". They are too close to raw fragments and manifests.
- Site-specific pages may require page metadata, player bootstrap JSON, or a resolver adapter before TuyulDM has stable downloadable URLs.
- UI still thinks in terms of "detected URL" instead of "resolved media offer".

Design rule for this phase:

- **Extraction** decides what asset exists.
- **Planning** decides which tracks / manifests / direct files represent that asset.
- **Engine** decides how bytes are fetched.
- **Mux/remux** decides how tracks become final output.
- **DRM or protected flows are refused, not bypassed.**

---

## Extraction strategy matrix

TuyulDM should choose strategy from evidence, not from one hardcoded downloader path.

| Delivery shape | Example signals | Strategy | Normalized output |
| --- | --- | --- | --- |
| Direct file | `.mp4`, `.mp3`, `Content-Disposition`, stable `Content-Length` | `direct_file` | one file URL |
| Progressive media | `<video src=...mp4>`, `Accept-Ranges: bytes`, no manifest | `progressive_stream` | one resumable asset |
| HLS manifest | `.m3u8`, `application/vnd.apple.mpegurl` | `hls_manifest` | one rendition plan or master-variant plan |
| DASH manifest | `.mpd`, `application/dash+xml` | `dash_manifest` | video track + audio track plan |
| MSE / blob player | `blob:` media element plus manifest/fragment fetches in page hook | `mse_observed_manifest` | same as HLS/DASH after reconstruction |
| Page bootstrap metadata | structured player JSON in HTML / inline scripts | `page_metadata` | direct asset or adaptive track plan |
| Site adapter / resolver | site known to hide asset graph behind custom JS/API | `site_adapter` | canonical asset plan from adapter |
| Protected / DRM | Widevine, PlayReady, encrypted HLS/DASH | `unsupported_protected` | refusal with reason |

Core rule: **segments never become user-facing download primitives**. They remain transport details under a resolved asset plan.

---

## Phase P — Canonical extraction contract

Before adding more extractors, freeze the boundary between browser detection and native download planning.

Files: new `native-host/extraction.go`, `native-host/protocol.go`, `native-host/main.go`, `src/App.tsx`, `extension/src/background/index.ts`.

Tasks:

- Add canonical types:
  ```go
  type ExtractionStrategy string

  const (
      StrategyDirectFile         ExtractionStrategy = "direct_file"
      StrategyProgressiveStream  ExtractionStrategy = "progressive_stream"
      StrategyHLSManifest        ExtractionStrategy = "hls_manifest"
      StrategyDASHManifest       ExtractionStrategy = "dash_manifest"
      StrategyMSEObserved        ExtractionStrategy = "mse_observed_manifest"
      StrategyPageMetadata       ExtractionStrategy = "page_metadata"
      StrategySiteAdapter        ExtractionStrategy = "site_adapter"
      StrategyUnsupportedProtected ExtractionStrategy = "unsupported_protected"
  )

  type MediaOffer struct {
      ID                string
      PageURL           string
      SourceURL         string
      SiteKey           string
      Title             string
      Strategy          ExtractionStrategy
      Container         string
      MimeType          string
      NeedsPlayback     bool
      Protected         bool
      ProtectedReason   string
      ExpiresAt         time.Time
      Tracks            []MediaTrack
      Variants          []VideoVariant
      Headers           map[string]string
      Cookies           []RequestCookie
      Debug             map[string]string
  }

  type DetectedEvidence struct {
      CandidateURL         string
      ContentType          string
      ManifestType         string
      MimeFromMSE          string
      SawBlobPlayback      bool
      SawRangeRequests     bool
      HadAudioVideoTraffic bool
      TopOrigin            string
  }

  type MediaTrack struct {
      ID          string
      Kind        string // video, audio, muxed
      URL         string
      ManifestURL string
      Codec       string
      Bitrate     int64
      Width       int
      Height      int
      Container   string
  }
  ```
- New IPCs:
  - `media.resolve { pageUrl, candidate, selectedVariantId?, headers, cookies }`
  - `media.download { offerId, selectedVariantId?, schedule? }`
- `download.video` remains as compatibility shim for one release, but internally calls the new resolver + planner.
- Persist on `DownloadState`:
  - `ExtractionStrategy`
  - `SiteKey`
  - `OfferTitle`
  - `OfferDebug`
  - `TrackCount`
- UI rows show `strategy`, `site`, and whether job is `direct`, `adaptive`, or `muxed`.

Acceptance:

- Background can resolve a media candidate into a `MediaOffer` without starting a download.
- UI can render one resolved offer for direct MP4, HLS, DASH, and protected content with distinct labels.
- Download rows persist strategy metadata across restart.

---

## Phase Q — Strategy router and confidence ranking

Add one dispatcher that chooses cheapest reliable extractor path from observed evidence.

Files: new `native-host/extractor_router.go`, `extension/src/shared/media_classify.ts`, `extension/src/background/index.ts`.

Tasks:

- Route candidates by ordered confidence:
  1. `direct_file`
  2. `progressive_stream`
  3. `hls_manifest`
  4. `dash_manifest`
  5. `mse_observed_manifest`
  6. `page_metadata`
  7. `site_adapter`
  8. `unsupported_protected`
- Ranking rule: prefer simplest strategy that produces stable downloadable asset.
- Add classifier evidence object:
  ```ts
  type MediaEvidence = {
    pageUrl: string
    candidateUrl: string
    contentType?: string
    manifestType?: 'HLS' | 'DASH'
    mimeFromMSE?: string
    sawBlobPlayback?: boolean
    sawRangeRequests?: boolean
    hadAudioAndVideoRequests?: boolean
    topOrigin: string
  }
  ```
- Keep host and extension evidence schemas mirrored. TS `MediaEvidence` should serialize cleanly into Go `DetectedEvidence`.
- Maintain `confidence` and `reason` on every route decision for debugging.
- If strategy selected is `page_metadata` or `site_adapter`, preserve the raw detected candidate list in `OfferDebug` so failures are reproducible.
- Add host logs:
  - `event=media_route_selected`
  - `strategy`
  - `site_key`
  - `confidence`
  - `reason`

Acceptance:

- Same candidate set can be routed deterministically in tests.
- Direct MP4 never goes through manifest parser.
- DASH candidate always resolves to adaptive plan, not a raw segment list in UI.

---

## Phase R — Generic extractors

Fill the router with extractor modules that work for most sites without site-specific code.

Files: new `native-host/extractors/direct.go`, `native-host/extractors/progressive.go`, `native-host/extractors/hls.go`, `native-host/extractors/dash.go`, `native-host/extractors/page_metadata.go`; refactor `native-host/video_manifest.go` and `native-host/video_download.go`.

Tasks:

- `direct.go`
  - Probe URL.
  - If stable content type, non-HTML body, and filename/container make sense, return single-track `MediaOffer`.
- `progressive.go`
  - Accept media URLs that support ranges and do not require manifest parsing.
  - Map directly to normal segmented file engine; no mux stage.
- `hls.go`
  - Reuse existing HLS parsing but return `MediaOffer` with `Variants` and a normalized selected rendition.
  - Keep segment enumeration private to the planner.
- `dash.go`
  - Reuse existing DASH parsing but return explicit video/audio tracks, not just one flat segment slice.
  - Planner later fans them into separate internal jobs and muxes final output.
- `page_metadata.go`
  - Parse site-provided bootstrap JSON or inline player config when directly available in page HTML.
  - Extract title, duration, available qualities, manifest URLs, direct track URLs, expiry timestamps when present.
  - Do not execute arbitrary page JS in host. Only parse data already available from browser-captured HTML or structured page payload.
- For HLS/DASH live/event playlists, return `OfferDebug["live"] = "true"` so UI can mark incomplete/live behavior.

Acceptance:

- Big Buck Bunny direct MP4 resolves as `progressive_stream`, downloads through file engine, no ffmpeg mux.
- Big Buck Bunny HLS resolves as `hls_manifest`, variants populate, output is one MP4.
- Sample DASH resolves as `dash_manifest`, audio/video tracks are visible in debug data, output is one muxed file.

---

## Phase S — Site adapters and external resolver boundary

Some sites do not expose clean direct/manifests to generic extractors. Those need adapter boundary, not more conditionals in the generic path.

Files: new `native-host/site_adapter.go`, new `native-host/site_adapters/`, `native-host/main.go`, `src/App.tsx`, `extension/src/background/index.ts`.

Tasks:

- Define adapter interface:
  ```go
  type SiteAdapter interface {
      Name() string
      Match(pageURL string, evidence []MediaEvidence) bool
      Resolve(ctx context.Context, input AdapterInput) (*MediaOffer, error)
  }
  ```
- `AdapterInput` includes:
  - page URL
  - top-frame URL
  - detected candidates
  - forwarded headers/cookies
  - optionally captured page HTML snapshot
- Add adapter registry by domain / heuristic match.
- Keep adapter output canonical: adapter returns `MediaOffer`, never starts download itself.
- First adapter class should be **external resolver adapter**:
  - host shells out to optional external tool for known sites
  - parses returned format graph into `MediaOffer`
  - caches result by `(pageUrl, selectedVariantId)` for short TTL
  - records tool version in `OfferDebug`
- Add settings:
  - enable/disable external resolver
  - binary path override
  - resolve timeout
  - adapter debug logging toggle
- When adapter output includes separate audio/video tracks, planner uses existing mux pipeline.

Design boundary:

- Core TuyulDM owns detection, routing, transport, resume, and mux.
- Site adapter owns site-specific media graph resolution.
- Protected / encrypted outputs still return refusal state.

Acceptance:

- Known site routed through adapter returns stable `MediaOffer` with title, variants, and track list.
- Adapter failure degrades to clear UI error `site_adapter_failed`, not raw segment download.
- Resolver binary missing results in actionable settings hint, not silent no-op.

---

## Phase T — Planner normalization and download assembly

Once offers are canonical, planner must convert them into internal engine jobs without leaking segments to UI.

Files: new `native-host/media_planner.go`, refactor `native-host/video_download.go`, `native-host/engine.go`, `native-host/ffmpeg.go`, `native-host/storage.go`.

Tasks:

- Add planner outputs:
  ```go
  type DownloadPlan struct {
      OfferID        string
      Strategy       ExtractionStrategy
      FinalContainer string
      Steps          []PlanStep
  }

  type PlanStep struct {
      Kind      string // file, hls_track, dash_track, mux, remux
      TrackID    string
      URL        string
      ManifestURL string
  }
  ```
- Planner rules:
  - `direct_file` / `progressive_stream` -> one normal file download.
  - `hls_manifest` -> one internal HLS rendition job -> concat/remux.
  - `dash_manifest` -> separate audio/video internal jobs -> mux.
  - `mse_observed_manifest` -> same as manifest type after manifest reconstruction.
  - `page_metadata` / `site_adapter` -> whatever tracks the offer contains.
- Persist plan provenance on `DownloadState` so refresh/resume can reacquire same asset type later.
- All segment files live under temp work dir and are deleted on success.
- Final UI always shows one logical asset, even if planner emitted many internal steps.
- Add `state.AssemblyStage` values:
  - `resolving`
  - `fetching`
  - `muxing`
  - `remuxing`
  - `finalizing`

Acceptance:

- User starts one adaptive offer and sees one queue row, not separate audio/video/segment rows.
- Failed mux preserves debug artifacts only when debug mode enabled.
- Resume after restart keeps same final asset row and reuses persisted plan.

---

## Phase U — Page-driven refresh and expiry recovery for adaptive offers

Signed adaptive URLs expire faster than plain files. Refresh flow must understand offer type.

Files: `native-host/engine.go`, new `native-host/offer_refresh.go`, `extension/src/background/index.ts`, `src/App.tsx`.

Tasks:

- Extend Phase J URL refresh into `offer.refresh`:
  - direct/progressive -> replace URL as today.
  - HLS/DASH/page_metadata/site_adapter -> rerun extractor path for same page URL, then compare normalized tracks.
- Add parity checks:
  - same site key
  - same title or near-match
  - same dominant variant resolution/container
  - same or compatible duration if known
- If normalized offer changed shape, prompt user:
  - `same asset, new URLs` -> resume
  - `different asset graph` -> restart from scratch
- If refresh requires page rescan, popup offers `Refresh from current tab` and reuses active tab cookies/headers.

Acceptance:

- Expired adaptive offer can refresh without exposing raw URL paste unless current strategy is plain direct file.
- If refreshed offer resolves to different quality ladder or different duration, UI blocks silent resume.

---

## Phase V — UX, diagnostics, and refusal states

Make strategy visible so users know why one site becomes single-file while another needs muxing.

Files: `src/App.tsx`, `extension/src/popup/main.tsx`, `extension/src/background/index.ts`.

Tasks:

- Detected media list shows badge per offer:
  - `Direct`
  - `Progressive`
  - `HLS`
  - `DASH`
  - `Observed in player`
  - `Site adapter`
  - `Protected`
- Download details panel shows:
  - extraction strategy
  - source page
  - variant / resolution
  - audio/video track count
  - current assembly stage
  - expiry state if known
- Add debug copy button that exports `MediaOffer` JSON with cookies stripped and headers redacted to safe allowlist.
- Protected content renders disabled row with specific reason:
  - `drm_detected`
  - `encrypted_hls`
  - `unsupported_site_strategy`
  - `site_adapter_failed`
- Replace vague errors like "unsupported manifest" with extractor-aware messages.

Acceptance:

- User can tell from UI why a download is muxing or why it was refused.
- Support logs contain enough strategy metadata to reproduce routing bugs.

---

## Suggested order

1. **Phase P** — half day. Freeze contract before more code spreads.
2. **Phase Q** — half day. Router + logs.
3. **Phase R** — 1.5 to 2 days. Generic extractors and refactor current manifest code.
4. **Phase T** — 1 day. Planner normalization so segments stay internal.
5. **Phase V** — half day. UI clarity.
6. **Phase S** — 1 to 1.5 days. Adapter boundary and settings.
7. **Phase U** — half day. Offer-aware refresh.

Total: ~5 to 6 working days on top of current engine work, assuming Phase O groundwork from `BUILD_PLAN_3.md` is already present or in flight.

---

## Smoke tests for the whole plan

- [ ] **Direct file**: plain MP4 URL resolves as `direct_file` or `progressive_stream`, downloads with no mux, final file opens.
- [ ] **Generic HLS**: master playlist resolves to one offer with quality variants; chosen variant downloads and remuxes to MP4.
- [ ] **Generic DASH**: MPD resolves to one offer with separate audio/video tracks; final output is one muxed file.
- [ ] **MSE/blob player**: after pressing play, page hook reconstructs manifest lineage and resolves one offer, not dozens of raw fragment rows.
- [ ] **Site adapter path**: adapter-backed site resolves one offer with title and variants; starting download yields one logical queue row.
- [ ] **Protected media**: DRM/encrypted sample is classified as `unsupported_protected`; row is disabled with clear reason.
- [ ] **Expiry refresh**: adaptive offer expires mid-download; refresh reruns extractor path and resumes only if normalized asset still matches.
- [ ] **Restart persistence**: active adaptive offer survives restart as one logical item with strategy metadata intact.

---

## Development notes

- Segmentation is not itself problem. HLS and DASH are segmented by design. Problem is letting segment-level evidence leak above extraction/planning layers.
- Do not add site-specific branches inside generic HLS/DASH parsers. Put them behind adapter boundary.
- Do not store raw cookies in exported debug payloads.
- Do not silently fall back from protected/adaptive failure into single-fragment download. That creates corrupted or incomplete output and hides real root cause.
- Prefer resolver adapters over in-core site-specific reverse engineering. Keep core maintainable.

---

## Success criteria

TuyulDM is done with this phase when:

- one page can yield multiple media candidates, but each candidate becomes one canonical `MediaOffer`;
- strategy choice is explicit, logged, and user-visible;
- direct/progressive/HLS/DASH/site-adapter paths share one planner and one engine;
- adaptive tracks mux into one final asset instead of surfacing as loose segments;
- protected flows are refused cleanly.