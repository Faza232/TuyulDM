# TuyulDM — Build Plan 5 (UI/UX Redesign)

Follow-up to `BUILD_PLAN_4.md`. That plan reshaped the **engine** so every detected media URL becomes a canonical `MediaOffer` with explicit strategy, tracks, plan, and assembly stage. This plan reshapes the **surfaces** that consume that data.

Today the UI is a single 2781-line `src/App.tsx` that renders the dashboard, popup, and options windows through a `surface` prop. Settings, downloads, and Video Grabber are inlined together. Download rows surface partial offer metadata. Popup duplicates dashboard chrome inside a 360px viewport. There is no command palette, no shared primitive library, and no consistent place for refusal/recovery copy.

Goal: a dense, mono, Linear/Vercel-flavored interface where each surface has one job, primitives are shared, and every piece of offer metadata coming from Phase P–V has a clear visual home.

Design rules for this phase:

- **Dashboard** is the workspace. Full queue, details, settings, logs.
- **Popup** is a single-purpose grabber. Detect on current tab, pick quality, hand off to dashboard queue.
- **Options** is the configuration surface. Tabbed sections, no download chrome.
- **Primitives are shared.** Buttons, inputs, badges, dialogs, drawers, command palette live in one library.
- **Strategy metadata is first-class.** Every row, drawer, and notification can be traced back to its `MediaOffer`.
- **Aesthetic is dense mono dark.** Tight grid, JetBrains Mono accents, neutral grays, one accent color, no decorative gradients.

Status legend: ☐ todo · ◐ partial · ☑ done.

---

## Current local gap

- `src/App.tsx` mixes three surfaces, settings, refresh dialogs, grabber, and toast logic in one component (≈2781 LOC).
- `src/index.css` carries only base resets and three utility classes. No design tokens, no primitive layer.
- Buttons, badges, selects, dialogs are repeated inline with bespoke Tailwind strings. No reuse, no a11y baseline.
- Sidebar tabs (`All / Active / Finished / Grabber`) are coupled with the popup viewport even though popup never needs a queue.
- Download row collapses `extraction_strategy`, `track_count`, `assembly_stage`, `offer_debug`, and error_code into ad-hoc inline text.
- Video Grabber section uses static card list. No live detection stream, no variant ladder picker, no poster + refusal recovery affordances.
- Settings is one long vertical scroll mixing interception, downloads, native host, permissions.
- No command palette, no global keyboard shortcuts, no focus management.
- Refusal codes (`drm_detected`, `encrypted_hls`, `site_adapter_failed`, etc.) surface as raw strings.

---

## Design system overview

| Token | Value |
| --- | --- |
| Background | `#0A0A0A` |
| Surface | `#111111` |
| Surface raised | `#161616` |
| Border subtle | `rgba(255,255,255,0.06)` |
| Border default | `rgba(255,255,255,0.10)` |
| Text primary | `#EDEDED` |
| Text muted | `rgba(255,255,255,0.55)` |
| Text dim | `rgba(255,255,255,0.35)` |
| Accent | `#FAFAFA` on `#0A0A0A` (high-contrast white CTA) |
| Danger | `#F87171` |
| Warning | `#FBBF24` |
| Success | `#34D399` |
| Mono font | `JetBrains Mono` (numbers, IDs, codes, kbd) |
| Sans font | `Inter` (prose, labels, controls) |
| Radius | `6px` / `8px` / `12px` (rows / chips / dialogs). No `2xl`+. |
| Motion | `120ms` default, `180ms` for drawers, ease `cubic-bezier(0.2, 0.8, 0.2, 1)`. Respect `prefers-reduced-motion`. |

Primitive set (Phase W locks):

`Button`, `IconButton`, `Input`, `Select`, `Checkbox`, `Switch`, `Tabs`, `Badge`, `Chip`, `Tooltip`, `Kbd`, `Dialog`, `Drawer`, `Menu`, `Toast`, `CommandPalette`, `Toolbar`, `Sidebar`, `Row`, `ProgressBar`, `EmptyState`.

---

## Phase W — Design tokens, primitive library, surface routing

Foundation. Nothing visual ships until tokens, primitives, and surface routing are in place.

Files: `src/index.css`, new `src/ui/tokens.ts`, new `src/ui/primitives/*`, new `src/ui/icons.ts`, `src/main.tsx`, `extension/src/popup/main.tsx`, `extension/src/options/main.tsx`.

Tasks:

- Add design tokens to `src/index.css` via `@theme`:
  ```css
  @theme {
    --color-bg: #0A0A0A;
    --color-surface: #111111;
    --color-surface-raised: #161616;
    --color-border: rgba(255,255,255,0.1);
    --color-border-subtle: rgba(255,255,255,0.06);
    --color-text: #EDEDED;
    --color-text-muted: rgba(255,255,255,0.55);
    --color-text-dim: rgba(255,255,255,0.35);
    --color-accent: #FAFAFA;
    --color-danger: #F87171;
    --color-warning: #FBBF24;
    --color-success: #34D399;
    --radius-sm: 6px;
    --radius-md: 8px;
    --radius-lg: 12px;
    --motion-fast: 120ms;
    --motion-default: 180ms;
    --motion-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  ```
- Build `src/ui/primitives/`:
  - `Button.tsx` — variants `primary | secondary | ghost | danger`, sizes `sm | md`, loading + disabled state.
  - `IconButton.tsx` — square, focus ring, tooltip wrapper.
  - `Input.tsx`, `Select.tsx`, `Checkbox.tsx`, `Switch.tsx` — controlled, ARIA-correct, keyboard navigable.
  - `Tabs.tsx` — roving tabindex, underline indicator.
  - `Badge.tsx`, `Chip.tsx` — strategy/status surfaces, `tone` prop.
  - `Tooltip.tsx`, `Kbd.tsx` — paired for shortcut hints.
  - `Dialog.tsx`, `Drawer.tsx` — focus trap, escape close, scrim, `motion/react` transitions.
  - `Menu.tsx` — right-click + dropdown menu, keyboard nav.
  - `Toast.tsx` + `ToastRegion.tsx` — stacked, dismissible, `tone` prop.
  - `Toolbar.tsx`, `Sidebar.tsx`, `Row.tsx` — layout building blocks.
  - `ProgressBar.tsx` — indeterminate + determinate.
  - `EmptyState.tsx` — title, body, action slot.
- Add `src/ui/primitives/index.ts` barrel.
- Add `src/ui/icons.ts` re-exporting curated lucide icons used app-wide (so swapping icon library later touches one file).
- Split `src/main.tsx` into three entry shells consumed by Vite:
  - `src/dashboard.tsx` mounts dashboard surface.
  - `src/popup.tsx` mounts popup surface.
  - `src/options.tsx` mounts options surface.
- Update `vite.config.ts` (and HTML entries `index.html`, `popup.html`, `options.html`) to point at the new entries. Keep extension build paths stable.
- Delete `data-row`, `col-header`, `data-value` ad-hoc classes from `src/index.css` once primitives cover them.

Acceptance:

- All three HTML entries boot to an empty primitive-only shell.
- Storybook-less smoke page (`src/ui/_dev.tsx`, gated behind dev flag) renders every primitive variant so visual regressions during the next phases are obvious.
- `App.tsx` still exists but no surface imports it yet; existing dashboard continues to mount under `surface='dashboard'` until Phase Y switches it over.
- Lint and typecheck clean.

---

## Phase X — Surface split and shared state hooks

Move logic out of `App.tsx` and into per-surface entries with one shared state core.

Files: new `src/surfaces/dashboard/`, `src/surfaces/popup/`, `src/surfaces/options/`; new `src/state/` (`downloads.ts`, `detection.ts`, `settings.ts`, `bridge.ts`, `toast.ts`).

Tasks:

- Extract bridge calls (chrome runtime, native host RPC, `media.resolve`, `media.download`, `offer.refresh`, settings reads/writes) into `src/state/bridge.ts` as a single typed client.
- Build hooks:
  - `useDownloads()` — list, pause/resume/cancel, optimistic mutations.
  - `useDetection()` — current tab detected offers stream, scan, refresh, variant selection.
  - `useSettings()` — read/update settings with optimistic write + revalidate.
  - `useToasts()` — push, dismiss, queue.
  - `useShortcuts()` — registers global keyboard shortcuts (used in Phase AD).
- Split UI:
  - `src/surfaces/dashboard/Dashboard.tsx` — sidebar + main shell + routes (queue / finished / grabber / logs / settings link).
  - `src/surfaces/popup/Popup.tsx` — single-purpose grabber (Phase AB target).
  - `src/surfaces/options/Options.tsx` — tabbed settings (Phase AC target).
- Each surface imports primitives from `src/ui/primitives` and state from `src/state/`.
- Delete `surface` prop from any remaining App.tsx callsites.
- Keep `App.tsx` only as compatibility re-export of `Dashboard` during transition; remove at end of Phase AG.

Acceptance:

- Each surface mounts in isolation. Dashboard works at parity with current `App.tsx`. Popup and options can still mount the legacy view if needed during transition (feature flag `legacy_ui=1`).
- No surface imports another surface's components directly.
- `src/App.tsx` LOC drops below 400, holds only the migration shim.

---

## Phase Y — Dashboard shell, sidebar, top toolbar

Redesign the dashboard chrome. Linear-style dense layout.

Files: `src/surfaces/dashboard/Dashboard.tsx`, new `src/surfaces/dashboard/Sidebar.tsx`, `src/surfaces/dashboard/TopBar.tsx`, `src/surfaces/dashboard/Routes.tsx`.

Tasks:

- New layout grid:
  ```
  +-----------------------------------------------------+
  | TopBar: brand · breadcrumb · search · cmd+k · CTA  |
  +-----------+-----------------------------------------+
  | Sidebar   | Main pane                              |
  | (collapse)|                                         |
  +-----------+-----------------------------------------+
  ```
- Sidebar: 220px expanded / 56px collapsed. Persists collapse state in `localStorage`. Sections: `Queue` (All / Active / Finished), `Discover` (Video Grabber), `System` (Logs, Settings, About).
- Sidebar items: icon + label + optional count badge. Active state = `var(--color-surface-raised)` background + left 2px accent bar.
- TopBar: 48px height. Brand mark + version chip on the left. Center: breadcrumb of current route. Right: `Add URL` button, search input, `⌘K` `Kbd` hint that opens command palette (Phase AD).
- Routes inside main pane are file-backed: `routes/Queue.tsx`, `routes/Finished.tsx`, `routes/Grabber.tsx`, `routes/Logs.tsx`. Hash-router or memory router; persist last route per surface in `localStorage`.
- Density toggle in TopBar overflow menu: `Cozy | Compact`. Stored in settings.

Acceptance:

- Sidebar collapse toggled by `[` shortcut and persists.
- Queue route mounts at boot if no stored route. Switching routes does not unmount global state hooks (`useDownloads` keeps subscription).
- TopBar `Add URL` and search hits primitive `Button` and `Input`, not bespoke markup.

---

## Phase Z — Download row redesign + details drawer

Rebuild how a `DownloadState` looks in the queue. Every Phase P–V offer field gets a clear home.

Files: new `src/surfaces/dashboard/routes/Queue.tsx`, `src/surfaces/dashboard/components/DownloadRow.tsx`, `src/surfaces/dashboard/components/DownloadDetailsDrawer.tsx`, `src/surfaces/dashboard/components/StrategyChip.tsx`, `src/surfaces/dashboard/components/AssemblyStageBadge.tsx`, `src/surfaces/dashboard/components/RefusalCell.tsx`.

Tasks:

- Row layout (compact density):
  ```
  [strategy] [title / filename]        [size]  [speed]  [progress %]  [stage]  [⋯]
                 short host · variant
  ```
- Strategy chip uses `STRATEGY_LABELS` from `extension/src/shared/media_classify`. Tone:
  - `direct_file`, `progressive_stream` → neutral.
  - `hls_manifest`, `dash_manifest`, `mse_observed_manifest` → accent.
  - `page_metadata`, `site_adapter` → info.
  - `unsupported_protected` → warning, locked icon, row disabled treatment.
- Assembly stage badge maps `resolving | fetching | muxing | remuxing | finalizing` to short chips with motion when active.
- Progress: thin 2px `ProgressBar` under the title row when downloading. Numeric % in mono on the right.
- Row click opens **DownloadDetailsDrawer** (slide-in from right, 480px, focus-trapped). Drawer sections:
  1. Header — filename, output path with `FolderOpen` action, status.
  2. Strategy — `extraction_strategy`, `site_key`, `track_count`, `plan.final_container`, `plan.steps` count.
  3. Tracks — list each track kind, codec, bitrate, resolution.
  4. Assembly — current `assembly_stage`, last attempt timestamp, last error.
  5. Expiry — if `offer_debug.expires_at` known, show countdown and `Refresh from current tab` action wired to `offer.refresh`.
  6. Debug — `Copy safe JSON` button using existing `buildSafeDebugSnapshot`. Headers and cookies stripped.
  7. Actions — Pause/Resume, Cancel, Open file, Open folder, Reveal source page.
- Right-click on a row opens a `Menu` with the same actions.
- Refusal rows render `RefusalCell` instead of progress: refusal reason copy + primary recovery CTA (`Try another source`, `Open adapter settings`, etc.).
- Bulk selection: shift-click row range, ⌘/Ctrl-click toggle. Bulk action bar appears in TopBar when selection > 0 (pause / resume / cancel / open folder).

Acceptance:

- Direct MP4 row shows neutral chip, no assembly stage, no tracks tab.
- HLS row shows accent chip, variants count, mux stage during finalize, single output file on completion.
- DASH row shows audio/video tracks split in drawer but single logical row.
- Protected row never offers Pause/Resume; only shows refusal reason and "Open documentation" link.
- Drawer escape + outside-click close. Focus returns to invoking row.

---

## Phase AA — Video Grabber rebuild (dashboard route)

Move Video Grabber from inlined card list to a live workspace.

Files: new `src/surfaces/dashboard/routes/Grabber.tsx`, `src/surfaces/dashboard/components/DetectedOfferCard.tsx`, `src/surfaces/dashboard/components/VariantPicker.tsx`, `src/surfaces/dashboard/components/PosterPreview.tsx`.

Tasks:

- Two-pane layout: detection feed on the left (sticky filters), focused offer detail on the right.
- Detection feed item shows:
  - poster thumb (16:9, lazy load, fallback to mono placeholder).
  - title (offer title from page metadata or filename).
  - host + page URL with `ExternalLink`.
  - strategy chip + protected lock badge.
  - quick action buttons: `Review`, `Download`, `Copy URL`, `Open Page`.
- Filters bar: by strategy, by site key, "show protected", "show expired". Persists per session.
- Focused detail pane:
  - poster + title + page URL.
  - `VariantPicker` — vertical list of `VideoVariant`. Shows bitrate, resolution, codec, container. Keyboard up/down navigates, Enter triggers download.
  - track list (for DASH).
  - debug payload preview (collapsed by default, expandable).
  - expiry indicator.
  - DRM/refusal banner with reason copy.
- Live updates: when background pushes new `media.detected` events, feed prepends with subtle fade-in (`motion/react`).
- Empty state uses `EmptyState` primitive with action `Scan current tab`.
- Scan button surfaces busy state via `ProgressBar` indeterminate in the toolbar.

Acceptance:

- Opening Grabber on an HLS page populates feed within one scan cycle.
- Variant picker shows all renditions and downloads the selected variant.
- Protected stream banner shows `describeProtectedReason` copy and disables Download.
- Switching focus between offers does not refetch unless the offer expired.

---

## Phase AB — Popup as single-purpose grabber

Popup is rebuilt as a 360×520 quick-action panel. No sidebar, no queue, no settings.

Files: `extension/src/popup/main.tsx`, new `src/surfaces/popup/Popup.tsx`, `src/surfaces/popup/CompactOfferList.tsx`, `src/surfaces/popup/CurrentTabHeader.tsx`.

Tasks:

- Layout:
  ```
  +-------------------------+
  | tab favicon · host      |
  | page title              |
  +-------------------------+
  | Scan tab   · Refresh    |
  +-------------------------+
  | offer 1 [strategy chip] |
  |   title   · variant ▼   |
  |   [Download]  [Open ↗]  |
  | offer 2 ...             |
  +-------------------------+
  | open dashboard ↗        |
  +-------------------------+
  ```
- `CurrentTabHeader` reads tab favicon + URL + title via chrome runtime.
- `CompactOfferList` reuses `DetectedOfferCard` in a denser variant.
- Variant picker is inline dropdown (popup is too small for full ladder).
- Download triggers `media.download` and immediately closes popup. Toast surfaces in dashboard.
- "Open dashboard" footer button opens dashboard tab focused on the just-queued download via `?focus=<id>` deep link.
- Permission onboarding banner (current `permissionOnboardingCard`) moves into popup top section only if `host_permissions` for current origin missing.
- Popup state is read-only beyond download trigger. No pause/resume/cancel — those live in dashboard.

Acceptance:

- Popup fits 360×520 without scroll on common cases (≤ 5 offers visible).
- Triggering download from popup closes popup and shows toast in dashboard if dashboard tab open.
- Permission onboarding does not appear when permission already granted.

---

## Phase AC — Options tabbed IA

Options gets a tabbed shell with clear sections.

Files: new `src/surfaces/options/Options.tsx`, `src/surfaces/options/sections/General.tsx`, `Detection.tsx`, `Network.tsx`, `Adapters.tsx`, `Storage.tsx`, `Logging.tsx`, `About.tsx`.

Tasks:

- Sidebar tabs (vertical, sticky), main pane scrolls.
- Sections:
  1. **General** — language, density, accent color (single-pick), open behavior on download finish.
  2. **Detection** — interception toggle, allowed origins manager, scan heuristics, blob/MSE hooks toggle.
  3. **Network** — concurrent downloads, max segment connections, request timeout, custom headers allowlist.
  4. **Adapters** — external resolver enable, binary path, resolve timeout, adapter debug logging (mirrors Phase S settings).
  5. **Storage** — default download folder, temp work dir, cleanup policy, disk space indicator.
  6. **Logging** — log verbosity, redact cookies/headers toggle, export logs button.
  7. **About** — version, native host status, update channel, links.
- Section heading style: small uppercase mono label + section title + description.
- Each setting uses primitive form controls. Async saves use `useSettings` + toast.
- Search field at top of options filters across sections (matches label or description).

Acceptance:

- Switching tabs preserves scroll position per tab.
- Saving a setting shows toast `Saved` with 1.5s dismiss. Failure shows danger toast with retry.
- Adapter section binary path validates against host via `adapter.probe` IPC.

---

## Phase AD — Command palette + keyboard shortcuts

Add a global command surface so dense layout stays fast.

Files: new `src/ui/CommandPalette.tsx`, `src/state/commands.ts`, `src/surfaces/dashboard/TopBar.tsx`, `src/state/shortcuts.ts`.

Tasks:

- `⌘K` / `Ctrl+K` opens command palette. Fuzzy match over registered commands.
- Commands registry seeds:
  - `Queue: pause all`, `Queue: resume all`, `Queue: cancel all`.
  - `Add URL…`
  - `Scan current tab`
  - `Open download folder`
  - `Open logs`, `Open settings`
  - `Toggle sidebar`
  - `Switch density: compact / cozy`
  - Dynamic per-download: `Pause <filename>`, `Open folder for <filename>`.
- Shortcut map:
  - `⌘K` palette.
  - `[` sidebar toggle.
  - `g q`, `g f`, `g d`, `g g`, `g s` route jumps.
  - `Space` pause/resume focused row.
  - `Enter` open details drawer.
  - `Del` cancel focused row (with confirm).
  - `?` show shortcuts cheat-sheet dialog.
- All shortcuts respect `input`/`textarea` focus, disabled when inside editable fields.
- Cheat sheet dialog lists shortcuts grouped by category, rendered with `Kbd` primitive.

Acceptance:

- Palette opens within 50ms, fuzzy matches by name + description.
- Keyboard nav (up/down/enter/escape) works.
- `?` opens cheat sheet, `Esc` closes.

---

## Phase AE — Error, refusal, and toast messaging system

Centralize all human-readable copy for errors and refusals coming from the engine.

Files: new `src/state/messages.ts`, `src/ui/Toast.tsx`, `src/surfaces/dashboard/components/RefusalCell.tsx`, `src/surfaces/dashboard/components/DownloadDetailsDrawer.tsx`.

Tasks:

- `src/state/messages.ts` exports:
  - `errorMessage(code, context)` → `{ title, body, recovery?: Action }`.
  - `refusalMessage(reason, context)` → same shape.
  - Codes covered: `drm_detected`, `encrypted_hls`, `unsupported_site_strategy`, `site_adapter_failed`, `manifest_expired`, `network_unreachable`, `disk_full`, `host_unreachable`, `permission_denied`, `unsupported_container`.
- Recovery actions are typed: `RefreshFromCurrentTab`, `OpenAdapterSettings`, `OpenPermissionsSettings`, `RetryDownload`, `OpenDocs(url)`.
- `RefusalCell` and drawer banner consume `refusalMessage`. Toast consumes `errorMessage` when an active download transitions to error state.
- Toast variants: `info`, `success`, `warning`, `danger`. Auto-dismiss after 6s except `danger` which stays until acknowledged.
- Toast stack max = 4; older toasts collapse into "+N more" expandable group.

Acceptance:

- Triggering each error code shows correct copy + matching recovery CTA.
- DRM offer shows lock icon, refusal banner, and no Retry CTA.
- Expired URL row shows "Refresh from current tab" and the action works end-to-end.

---

## Phase AF — Motion, density, accessibility pass

Polish layer. Nothing functional, everything perceptual.

Files: `src/ui/primitives/*`, `src/index.css`, `src/state/settings.ts`.

Tasks:

- Motion:
  - All transitions use `var(--motion-default)` and `var(--motion-ease)`.
  - Detect `prefers-reduced-motion: reduce`; collapse all motion to opacity-only fades.
  - Row enter/exit uses 120ms slide+fade.
  - Drawer + dialog use 180ms.
- Density:
  - `Compact` density: row height 36px, gap 8px, font-size 12px for labels.
  - `Cozy` density (default): row height 52px, gap 12px, font-size 13px.
  - Toggle persisted in settings; respected by `Row`, `Toolbar`, `Sidebar`.
- Accessibility:
  - All interactive elements have visible focus ring (`outline: 1px solid var(--color-accent)` + `outline-offset: 2px`).
  - Color contrast pass: ensure `text-muted` ≥ 4.5:1 on `bg`, `text-dim` ≥ 3:1 (decorative only).
  - ARIA roles audited on `Dialog`, `Drawer`, `Menu`, `Tabs`, `Toast`.
  - `Esc` closes the topmost overlay only.
  - Tab order documented per surface (manual annotation in `src/ui/_a11y_notes.md`).
- Screenshot smoke set: capture queue, drawer, grabber, popup, options at both densities and both motion modes.

Acceptance:

- Lighthouse a11y score ≥ 95 on dashboard route.
- All primitives keyboard-only usable.
- Reduced motion path verified manually with system flag.

---

## Phase AG — Migration cleanup and removal of legacy `App.tsx`

Strip the bridge between old and new.

Files: `src/App.tsx` (delete), `src/main.tsx` (delete or repurpose), `index.html`, `popup.html`, `options.html`, `vite.config.ts`.

Tasks:

- Verify no surface imports `App.tsx` or legacy helpers.
- Remove `legacy_ui=1` flag from Phase X.
- Delete dead state (`isAdding`, `permissionOnboardingCard` in old shape, refresh dialog plumbing) once new components own it.
- Run typecheck, lint, prod build.
- Update `extension/manifest.json` paths if popup/options bundle names changed.
- Update `README.md` screenshots and `CONTEXT.md` snippets referring to the old shell.

Acceptance:

- `git grep "src/App.tsx"` returns zero hits outside historical files.
- Prod build size for dashboard ≤ pre-redesign size + 15%, popup ≤ pre-redesign size + 5%.
- Manual smoke: queue, grabber, popup quick-download, options save, refusal CTA, palette shortcut all green.

---

## Suggested order

1. **Phase W** — 1.5 days. Tokens + primitives + entry split.
2. **Phase X** — 1 day. Surface split, shared state hooks.
3. **Phase Y** — 1 day. Dashboard shell.
4. **Phase Z** — 1.5 days. Row + details drawer.
5. **Phase AA** — 1 day. Grabber rebuild.
6. **Phase AB** — 0.5 day. Popup compact grabber.
7. **Phase AC** — 1 day. Options tabbed IA.
8. **Phase AD** — 0.5 day. Command palette + shortcuts.
9. **Phase AE** — 0.5 day. Messaging system.
10. **Phase AF** — 1 day. Motion + density + a11y.
11. **Phase AG** — 0.5 day. Migration cleanup.

Total: ~10 working days. Parallelizable: Phase AC and Phase AB can run beside Phase Z once primitives are in.

---

## Smoke tests for the whole plan

- [ ] **Cold boot dashboard**: loads to Queue route with stored route restored, sidebar collapse state restored.
- [ ] **Add URL flow**: TopBar `Add URL` opens dialog, valid URL queues download, toast confirms.
- [ ] **Direct file row**: shows neutral strategy chip, single output, no track list in drawer.
- [ ] **HLS row + drawer**: shows accent chip, variants in drawer, assembly stage transitions through `fetching → remuxing → finalizing`.
- [ ] **DASH row + drawer**: shows separate audio/video tracks in drawer but one logical row, mux completes to single file.
- [ ] **Protected row**: refusal banner with reason copy, no Pause/Resume actions, recovery CTA opens docs.
- [ ] **Grabber live feed**: opening a page with HLS adds offer to feed on scan; variant picker shows full ladder; selected variant downloads.
- [ ] **Popup quick download**: open popup on detected page, pick variant, hit Download — popup closes, dashboard shows queued row.
- [ ] **Options save**: change a setting, see `Saved` toast within 1.5s; reload retains value.
- [ ] **Command palette**: `⌘K` opens, `pause all` matches and works.
- [ ] **Shortcut routing**: `g g` jumps to Grabber, `[` collapses sidebar, `?` shows cheat sheet.
- [ ] **Refusal recovery**: expired URL row → click `Refresh from current tab` → row resumes if parity passes, blocks resume otherwise.
- [ ] **Reduced motion**: enable system flag, drawer/dialog open with opacity fade only.
- [ ] **Density toggle**: switch to Compact, row height shrinks to 36px, persists across reload.
- [ ] **A11y**: Lighthouse a11y ≥ 95, all primitives operable by keyboard, focus ring visible everywhere.

---

## Development notes

- Do not introduce per-component CSS files. All styling stays in Tailwind utility classes + tokens.
- Do not pull in shadcn package directly. Replicate the primitives we need; gives full control over motion/density and avoids transitive deps.
- Do not duplicate offer metadata mapping between dashboard and popup. Both consume the same hooks from `src/state/`.
- Do not silently fall back to legacy components after Phase AG. Removed code stays removed.
- Keep `extension/src/shared/media_classify` as the single source for `STRATEGY_LABELS` and `strategyAssemblyKind`. The UI never invents its own label list.
- Headers/cookies in any debug copy export must continue to be stripped/redacted as in `buildSafeDebugSnapshot`.
- Treat any new surface affordance as a candidate for the command palette. If a feature exists only behind a click, it is half-discoverable.

---

## Success criteria

TuyulDM is done with this phase when:

- one component library powers dashboard, popup, and options;
- the dashboard surfaces every Phase P–V offer field (strategy, tracks, plan, assembly stage, expiry, refusal reason) in a clear location;
- the popup is a focused grabber that hands off to the dashboard for queue work;
- the options surface is tabbed, searchable, and consistent with the rest of the app;
- every error and refusal has human copy and a recovery path;
- the app is keyboard-driveable end-to-end and a11y score ≥ 95 on the main route;
- `src/App.tsx` no longer exists, and no surface imports from a "legacy" path.
