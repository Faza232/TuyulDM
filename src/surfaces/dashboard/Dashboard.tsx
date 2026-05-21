import { useState, useEffect } from 'react';
import { useDownloads, useDetection, useSettings, useToasts } from '../../state';
import { useCommands } from '../../state/commands';
import { useShortcuts } from '../../state/shortcuts';
import { AppSidebar, type AppRoute } from './Sidebar';
import { TopBar } from './TopBar';

import QueueRoute from './routes/Queue';
import FinishedRoute from './routes/Finished';
import GrabberRoute from './routes/Grabber';
import LogsRoute from './routes/Logs';

import { CommandPalette } from '../../ui/primitives/CommandPalette';
import { ShortcutsDialog } from '../../ui/ShortcutsDialog';

// Temporary shim for the 'surface' prop
export default function Dashboard({ surface = 'dashboard' }: { surface?: 'dashboard' | 'popup' | 'options' }) {
  const [activeRoute, setActiveRoute] = useState<AppRoute>(() => {
    const saved = localStorage.getItem('tuyuldm.route');
    return (saved as AppRoute) || 'queue';
  });

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('tuyuldm.sidebar') === '1';
  });
  
  const [showShortcuts, setShowShortcuts] = useState(false);

  const { downloads } = useDownloads();
  const { streams } = useDetection();
  
  const { commands, registerCommands, open: paletteOpen, setOpen: setPaletteOpen, toggleOpen: togglePaletteOpen } = useCommands();

  useEffect(() => {
    localStorage.setItem('tuyuldm.route', activeRoute);
  }, [activeRoute]);

  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem('tuyuldm.sidebar', next ? '1' : '0');
  };

  useShortcuts([
    { key: 'k', meta: true, description: 'Command palette', handler: togglePaletteOpen },
    { key: 'k', ctrl: true, description: 'Command palette', handler: togglePaletteOpen },
    { key: '[', description: 'Toggle sidebar', handler: toggleSidebar },
    { key: '?', description: 'Show shortcuts', handler: () => setShowShortcuts(true) },
    // Route jumps
    { key: 'q', description: 'Go to queue', handler: (e) => { setActiveRoute('queue'); } }, // simplified
    { key: 'f', description: 'Go to finished', handler: (e) => { setActiveRoute('finished'); } },
    { key: 'g', description: 'Go to grabber', handler: (e) => { setActiveRoute('grabber'); } }
  ]);

  useEffect(() => {
    return registerCommands([
      { id: 'global:palette', label: 'Command Palette', description: 'Open command palette', shortcut: ['⌘', 'K'], onSelect: () => setPaletteOpen(true) },
      { id: 'view:sidebar', label: 'Toggle Sidebar', description: 'Expand or collapse sidebar', shortcut: ['['], onSelect: toggleSidebar },
      { id: 'view:shortcuts', label: 'Keyboard Shortcuts', description: 'Show cheat sheet', shortcut: ['?'], onSelect: () => setShowShortcuts(true) },
      { id: 'nav:queue', label: 'Go to Queue', group: 'Navigation', shortcut: ['g', 'q'], onSelect: () => setActiveRoute('queue') },
      { id: 'nav:finished', label: 'Go to Finished', group: 'Navigation', shortcut: ['g', 'f'], onSelect: () => setActiveRoute('finished') },
      { id: 'nav:grabber', label: 'Go to Video Grabber', group: 'Navigation', shortcut: ['g', 'g'], onSelect: () => setActiveRoute('grabber') },
      { id: 'nav:logs', label: 'Go to Logs', group: 'Navigation', onSelect: () => setActiveRoute('logs') },
      { id: 'nav:settings', label: 'Open Settings', group: 'Navigation', onSelect: () => window.open(chrome.runtime.getURL('options.html')) }
    ]);
  }, []);

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
          onAddUrl={() => alert('TODO: Add URL flow')}
          onSearch={(q) => console.log('Search:', q)}
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
      
      <CommandPalette 
        open={paletteOpen} 
        onClose={() => setPaletteOpen(false)} 
        items={commands} 
      />
      
      <ShortcutsDialog open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </div>
  );
}
