import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu } from '../../ui/primitives';
import type { MenuItem } from '../../ui/primitives';
import { Pause, Play, Trash2, FolderOpen, FileIcon, ExternalLink } from '../../ui/icons';
import { CommandPalette } from '../../ui/CommandPalette';
import { DashboardSidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Queue } from './routes/Queue';
import { Finished } from './routes/Finished';
import { Grabber } from './routes/Grabber';
import { Logs } from './routes/Logs';
import { DownloadDetailsDrawer } from './components/DownloadDetailsDrawer';
import { AddUrlDialog } from './components/AddUrlDialog';
import { RefreshUrlDialog } from './components/RefreshUrlDialog';
import { CheatSheet } from './components/CheatSheet';
import { DashboardContext } from './context';
import type { DashboardRoute, DashboardContextValue } from './context';
import { useDownloads, useSystem } from '../../state/store';
import { usePreferences } from '../../state/preferences';
import { useToasts } from '../../state/toast';
import { useShortcuts } from '../../state/shortcuts';
import { buildCommands } from '../../state/commands';
import { bridge } from '../../state/bridge';
import type { DownloadItem } from '../../state/types';
import type { RecoveryAction } from '../../state/messages';
import { downloadNeedsUrlRefresh } from '../../ui/format';

const ROUTE_KEY = 'tuyuldm_route';
const COLLAPSE_KEY = 'tuyuldm_sidebar_collapsed';
const DOCS_URL = 'https://github.com/husainfaza/TuyulDM';

export function Dashboard() {
  const { downloads, pause, resume, pauseAll, resumeAll, remove, openFile, revealInFolder } = useDownloads();
  const { hostStats } = useSystem();
  const { prefs, setPrefs } = usePreferences();
  const { push } = useToasts();

  const [route, setRoute] = useState<DashboardRoute>(() => (localStorage.getItem(ROUTE_KEY) as DashboardRoute) || 'queue');
  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const lastIndex = useRef<number>(-1);
  const [drawerId, setDrawerId] = useState<string | number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [refreshTarget, setRefreshTarget] = useState<DownloadItem | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [cheatOpen, setCheatOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; download: DownloadItem } | null>(null);

  useEffect(() => { localStorage.setItem(ROUTE_KEY, route); }, [route]);
  useEffect(() => { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); }, [collapsed]);

  // deep-link ?focus=<id> opens the details drawer
  useEffect(() => {
    const focus = new URLSearchParams(location.search).get('focus');
    if (focus) setDrawerId(focus);
  }, []);

  const navigate = useCallback((r: DashboardRoute) => setRoute(r), []);
  const openOptions = useCallback(() => bridge.openOptionsPage(), []);

  // ---- actions ----
  const togglePlayPause = useCallback((d: DownloadItem) => {
    if (downloadNeedsUrlRefresh(d)) { setRefreshTarget(d); return; }
    if (d.status === 'downloading' || d.status === 'queued' || d.status === 'muxing') void pause(d.id);
    else void resume(d.id);
  }, [pause, resume]);

  const cancel = useCallback((d: DownloadItem) => { void remove(d.id, false); }, [remove]);
  const openSource = useCallback((d: DownloadItem) => {
    const url = d.url || d.offer_debug?.page_url;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const recover = useCallback((action: RecoveryAction, d: DownloadItem) => {
    switch (action.kind) {
      case 'RefreshFromCurrentTab': setRefreshTarget(d); break;
      case 'OpenAdapterSettings':
      case 'OpenPermissionsSettings': openOptions(); break;
      case 'RetryDownload': void resume(d.id); break;
      case 'OpenDocs': window.open(action.url, '_blank', 'noopener,noreferrer'); break;
    }
  }, [openOptions, resume]);

  const copyDebug = useCallback(async (text: string) => {
    try { await navigator.clipboard.writeText(text); push({ tone: 'success', title: 'Debug copied' }); }
    catch { push({ tone: 'danger', title: 'Copy failed' }); }
  }, [push]);

  // ---- selection ----
  const isSelected = useCallback((id: number | string) => selection.has(String(id)), [selection]);
  const clearSelection = useCallback(() => { setSelection(new Set()); lastIndex.current = -1; }, []);

  const onSelectRow = useCallback((e: React.MouseEvent, d: DownloadItem, visible: DownloadItem[]) => {
    const idx = visible.findIndex((x) => x.id === d.id);
    setSelection((prev) => {
      const next = new Set(prev);
      const key = String(d.id);
      if (e.shiftKey && lastIndex.current >= 0) {
        const [a, b] = [lastIndex.current, idx].sort((m, n) => m - n);
        for (let i = a; i <= b; i++) next.add(String(visible[i].id));
      } else if (e.metaKey || e.ctrlKey) {
        next.has(key) ? next.delete(key) : next.add(key);
      } else {
        if (next.has(key) && next.size === 1) next.delete(key);
        else { next.clear(); next.add(key); }
      }
      return next;
    });
    lastIndex.current = idx;
  }, []);

  const openContextMenu = useCallback((e: React.MouseEvent, d: DownloadItem) => {
    setContextMenu({ x: e.clientX, y: e.clientY, download: d });
  }, []);

  const drawerDownload = useMemo(() => downloads.find((d) => String(d.id) === String(drawerId)) || null, [downloads, drawerId]);

  // ---- bulk ----
  const onBulk = useCallback((action: 'pause' | 'resume' | 'cancel' | 'folder') => {
    const ids = Array.from(selection);
    const items = downloads.filter((d) => ids.includes(String(d.id)));
    items.forEach((d) => {
      if (action === 'pause') void pause(d.id);
      else if (action === 'resume') void resume(d.id);
      else if (action === 'cancel') void remove(d.id, false);
      else if (action === 'folder') void revealInFolder(d.id);
    });
    if (action === 'cancel' || action === 'pause' || action === 'resume') clearSelection();
  }, [selection, downloads, pause, resume, remove, revealInFolder, clearSelection]);

  // ---- counts ----
  const counts = useMemo(() => ({
    all: downloads.length,
    active: downloads.filter((d) => ['downloading', 'queued', 'muxing'].includes(d.status)).length,
    finished: downloads.filter((d) => d.status === 'finished').length,
  }), [downloads]);

  // ---- commands ----
  const commands = useMemo(() => buildCommands({
    navigate: (r) => navigate(r as DashboardRoute),
    pauseAll: () => void pauseAll(),
    resumeAll: () => void resumeAll(),
    cancelAll: () => downloads.forEach((d) => void remove(d.id, false)),
    addUrl: () => setAddOpen(true),
    scanTab: () => navigate('grabber'),
    openDownloadFolder: () => { const f = downloads.find((d) => d.output_path); if (f) void revealInFolder(f.id); },
    openLogs: () => navigate('logs'),
    openSettings: openOptions,
    toggleSidebar: () => setCollapsed((c) => !c),
    setDensity: (d) => setPrefs({ density: d }),
    downloads,
    pause: (id) => void pause(id),
    revealInFolder: (id) => void revealInFolder(id),
  }), [navigate, pauseAll, resumeAll, remove, downloads, revealInFolder, openOptions, setPrefs, pause]);

  // ---- shortcuts ----
  useShortcuts({
    'mod+k': () => setPaletteOpen((o) => !o),
    '[': () => setCollapsed((c) => !c),
    '?': () => setCheatOpen(true),
    'g q': () => navigate('queue'),
    'g f': () => navigate('finished'),
    'g g': () => navigate('grabber'),
    'g d': () => navigate('queue'),
    'g s': () => openOptions(),
  });

  const value: DashboardContextValue = {
    route, navigate, density: prefs.density, search,
    selection, isSelected, onSelectRow, clearSelection,
    openDrawer: (d) => setDrawerId(d.id),
    togglePlayPause, cancel, openFile: (d) => void openFile(d.id), reveal: (d) => void revealInFolder(d.id),
    openSource, recover, openContextMenu, openAddUrl: () => setAddOpen(true),
  };

  const contextItems: MenuItem[] = contextMenu ? (() => {
    const d = contextMenu.download;
    const isProtected = d.extraction_strategy === 'unsupported_protected';
    const isActive = ['downloading', 'queued', 'muxing'].includes(d.status);
    if (isProtected) {
      return [
        { label: 'Open source page', icon: <ExternalLink size={14} />, onSelect: () => openSource(d) },
        { label: 'Open documentation', icon: <ExternalLink size={14} />, onSelect: () => window.open(`${DOCS_URL}#troubleshooting`, '_blank') },
      ];
    }
    return [
      { label: isActive ? 'Pause' : 'Resume', icon: isActive ? <Pause size={14} /> : <Play size={14} />, onSelect: () => togglePlayPause(d) },
      { label: 'Open file', icon: <FileIcon size={14} />, disabled: d.status !== 'finished', onSelect: () => void openFile(d.id) },
      { label: 'Open folder', icon: <FolderOpen size={14} />, disabled: !d.output_path, onSelect: () => void revealInFolder(d.id) },
      { type: 'separator' },
      { label: 'Cancel', tone: 'danger', icon: <Trash2 size={14} />, onSelect: () => cancel(d) },
    ];
  })() : [];

  return (
    <DashboardContext.Provider value={value}>
      <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">
        <DashboardSidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          route={route}
          navigate={navigate}
          counts={counts}
          onOpenSettings={openOptions}
          onAbout={() => window.open(DOCS_URL, '_blank', 'noopener,noreferrer')}
        />
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar
            route={route}
            search={search}
            onSearch={setSearch}
            onAddUrl={() => setAddOpen(true)}
            onOpenPalette={() => setPaletteOpen(true)}
            density={prefs.density}
            setDensity={(d) => setPrefs({ density: d })}
            globalSpeed={hostStats.globalSpeedBytesPerSecond}
            selectionCount={selection.size}
            onBulk={onBulk}
            onClearSelection={clearSelection}
          />
          <main className="flex-1 overflow-y-auto">
            {route === 'queue' && <Queue filter="all" />}
            {route === 'finished' && <Finished />}
            {route === 'grabber' && <Grabber />}
            {route === 'logs' && <Logs />}
          </main>
        </div>
      </div>

      <DownloadDetailsDrawer
        download={drawerDownload}
        open={drawerId != null}
        onClose={() => setDrawerId(null)}
        onTogglePlayPause={togglePlayPause}
        onCancel={(d) => { cancel(d); setDrawerId(null); }}
        onOpenFile={(d) => void openFile(d.id)}
        onReveal={(d) => void revealInFolder(d.id)}
        onOpenSource={openSource}
        onRefreshFromTab={(d) => { setRefreshTarget(d); }}
        onCopyDebug={copyDebug}
      />

      <AddUrlDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <RefreshUrlDialog download={refreshTarget} open={refreshTarget != null} onClose={() => setRefreshTarget(null)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
      <CheatSheet open={cheatOpen} onClose={() => setCheatOpen(false)} />

      {contextMenu && (
        <Menu
          open
          onClose={() => setContextMenu(null)}
          items={contextItems}
          position={{ x: contextMenu.x, y: contextMenu.y }}
        />
      )}
    </DashboardContext.Provider>
  );
}
