# Accessibility notes (Phase AF)

Per-surface tab order and ARIA contract for the primitive library and surfaces.

## Global
- Focus ring: `*:focus-visible { outline: 1px solid var(--color-accent); outline-offset: 2px }` (src/index.css).
- Reduced motion: `@media (prefers-reduced-motion: reduce)` collapses all transitions/animations to ~0ms.
- Escape closes the topmost overlay only — `escStack` in `primitives/overlay.ts` keeps a LIFO of open overlays; only the last registered handler fires.
- Body scroll locked while any overlay is open (`useBodyScrollLock`, ref-counted).

## Primitives
- `Dialog` / `Drawer`: `role="dialog"` + `aria-modal`, focus trap on open (`useFocusTrap`), focus restored to invoker on close, scrim click + Escape close.
- `Menu`: `role="menu"` / `role="menuitem"`, ArrowUp/Down move, Enter activates, outside-click + Escape close.
- `Tabs`: `role="tablist"`/`tab`, roving tabindex, Arrow/Home/End navigation.
- `Switch`: `role="switch"` + `aria-checked`. `Checkbox`: native input, label association.
- `Tooltip`: `role="tooltip"` + `aria-describedby` wired to trigger on hover/focus.
- `ProgressBar`: `role="progressbar"` with `aria-valuemin/max/now` (omitted when indeterminate).
- `Toast`: `role="status"`, `aria-live` = assertive for danger, polite otherwise.

## Dashboard
- Tab order: Sidebar collapse → sidebar nav items → TopBar search → ⌘K → Add URL → overflow → main rows.
- `⌘K` command palette; `[` sidebar; `?` cheat sheet; `g q/f/g/s` route jumps. All skip editable fields except `mod+k`.
- Known gap: per-row Space/Resume, Enter/open, Del/cancel are documented in the cheat sheet but require a row-focus model not yet implemented.

## Popup
- Single column, no traps. Scan → offer list → download → open dashboard footer.

## Options
- Vertical tab list (buttons) → search → section form controls. Scroll position preserved per tab.
