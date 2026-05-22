import { useEffect } from 'react';
import { useDownloads, useDetection } from '../../state';
import { useUISettings, useUISettingsStore } from '../../state/ui_settings';
import { useCommands } from '../../state/commands';
import { useShortcuts } from '../../state/shortcuts';
import { useDialogs } from '../../state/dialogs';
import { AppSidebar, type AppRoute } from './Sidebar';
import { TopBar } from './TopBar';

import QueueRoute from './routes/Queue';
import FinishedRoute from './routes/Finished';
import GrabberRoute from './routes/Grabber';
import LogsRoute from './routes/Logs';

import { CommandPalette } from '../../ui/primitives/CommandPalette';
import { ShortcutsDialog } from '../../ui/ShortcutsDialog';
import { AddUrlDialog } from './components/AddUrlDialog';
import { ConfirmDialog } from './components/ConfirmDialog';

const ROUTES: AppRoute[] = ['queue', 'finished', 'grabber', 'logs', 'settings'];
function isRoute(v: unknown): v is AppRoute {
  return typeof v === 'string' && (ROUTES as readonly string[]).includes(v);
}

export default function Dashboard() {
  const { uiSettings, updateUISettings } = useUISettings();
  const activeRoute: AppRoute = isRoute(uiSettings.route) ? uiSettings.route : 'queue';
  const sidebarCollapsed = uiSettings.sidebarCollapsed;
  const showShortcuts = uiSettings.shortcutsOpen;

  const setActiveRoute = (r: AppRoute) => updateUISettings({ route: r });
  const setShowShortcuts = (v: boolean) => updateUISettings({ shortcutsOpen: v });
  const toggleSidebar = () => updateUISettings({ sidebarCollapsed: !sidebarCollapsed });

  const { downloads } = useDownloads();
  const { streams } = useDetection();

  const commands = useCommands((s) => s.commands);
  const registerCommands = useCommands((s) => s.registerCommands);
  const paletteOpen = useCommands((s) => s.open);
  const setPaletteOpen = useCommands((s) => s.setOpen);
  const togglePaletteOpen = useCommands((s) => s.toggleOpen);
  const { addUrlOpen, openAddUrl, closeAddUrl } = useDialogs();

  useShortcuts([
    { key: 'k', meta: true, description: 'Command palette', handler: togglePaletteOpen },
    { key: 'k', ctrl: true, description: 'Command palette', handler: togglePaletteOpen },
    { key: '[', description: 'Toggle sidebar', handler: toggleSidebar },
    { key: '?', description: 'Show shortcuts', handler: () => setShowShortcuts(true) },
    { key: 'q', description: 'Go to queue', handler: () => setActiveRoute('queue') },
    { key: 'f', description: 'Go to finished', handler: () => setActiveRoute('finished') },
    { key: 'g', description: 'Go to grabber', handler: () => setActiveRoute('grabber') },
  ]);

  useEffect(() => {
    return registerCommands([
      { id: 'global:palette', label: 'Command Palette', description: 'Open command palette', shortcut: ['⌘', 'K'], onSelect: () => setPaletteOpen(true) },
      { id: 'global:add-url', label: 'Add URL', description: 'Queue a media URL', shortcut: ['n'], onSelect: openAddUrl },
      { id: 'view:sidebar', label: 'Toggle Sidebar', description: 'Expand or collapse sidebar', shortcut: ['['], onSelect: () => updateUISettings({ sidebarCollapsed: !useUISettingsStore.getState().uiSettings.sidebarCollapsed }) },
      { id: 'view:shortcuts', label: 'Keyboard Shortcuts', description: 'Show cheat sheet', shortcut: ['?'], onSelect: () => updateUISettings({ shortcutsOpen: true }) },
      { id: 'nav:queue', label: 'Go to Queue', group: 'Navigation', shortcut: ['g', 'q'], onSelect: () => updateUISettings({ route: 'queue' }) },
      { id: 'nav:finished', label: 'Go to Finished', group: 'Navigation', shortcut: ['g', 'f'], onSelect: () => updateUISettings({ route: 'finished' }) },
      { id: 'nav:grabber', label: 'Go to Video Grabber', group: 'Navigation', shortcut: ['g', 'g'], onSelect: () => updateUISettings({ route: 'grabber' }) },
      { id: 'nav:logs', label: 'Go to Logs', group: 'Navigation', onSelect: () => updateUISettings({ route: 'logs' }) },
      { id: 'nav:settings', label: 'Open Settings', group: 'Navigation', onSelect: () => window.open(chrome.runtime.getURL('options.html')) },
      { id: 'sys:density:cozy', label: 'Density: Cozy', group: 'System', onSelect: () => updateUISettings({ density: 'cozy' }) },
      { id: 'sys:density:compact', label: 'Density: Compact', group: 'System', onSelect: () => updateUISettings({ density: 'compact' }) },
    ]);
  }, [registerCommands, setPaletteOpen, openAddUrl, updateUISettings]);

  const activeDownloads = downloads.filter(d => ['downloading', 'queued', 'muxing'].includes(d.status)).length;
  const finishedDownloads = downloads.filter(d => d.status === 'finished').length;
  const grabberStreams = streams.length;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
      <AppSidebar
        collapsed={sidebarCollapsed}
        activeRoute={activeRoute}
        onRouteChange={setActiveRoute}
        counts={{ queue: activeDownloads, finished: finishedDownloads, grabber: grabberStreams }}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar
          activeRoute={activeRoute}
          onAddUrl={openAddUrl}
          toggleSidebar={toggleSidebar}
        />
        <main className="flex-1 overflow-auto bg-[var(--color-bg)]">
          {activeRoute === 'queue' && <QueueRoute />}
          {activeRoute === 'finished' && <FinishedRoute />}
          {activeRoute === 'grabber' && <GrabberRoute />}
          {activeRoute === 'logs' && <LogsRoute />}
          {activeRoute === 'settings' && <div className="p-4">Settings handled via popup</div>}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={commands} />
      <ShortcutsDialog open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <AddUrlDialog open={addUrlOpen} onClose={closeAddUrl} />
      <ConfirmDialog />
    </div>
  );
}
