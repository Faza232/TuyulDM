import { useState, useEffect } from 'react';
import { useDownloads, useDetection, useSettings, useToasts } from '../../state';
import { AppSidebar, type AppRoute } from './Sidebar';
import { TopBar } from './TopBar';

import QueueRoute from './routes/Queue';
import FinishedRoute from './routes/Finished';
import GrabberRoute from './routes/Grabber';
import LogsRoute from './routes/Logs';

// Temporary shim for the 'surface' prop
export default function Dashboard({ surface = 'dashboard' }: { surface?: 'dashboard' | 'popup' | 'options' }) {
  const [activeRoute, setActiveRoute] = useState<AppRoute>(() => {
    const saved = localStorage.getItem('tuyuldm.route');
    return (saved as AppRoute) || 'queue';
  });

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('tuyuldm.sidebar') === '1';
  });

  const { downloads } = useDownloads();
  const { streams } = useDetection();

  useEffect(() => {
    localStorage.setItem('tuyuldm.route', activeRoute);
  }, [activeRoute]);

  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem('tuyuldm.sidebar', next ? '1' : '0');
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Ignore if mostly in input/textarea unless it's an overlay trigger
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        return;
      }
      if (e.key === '[') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [sidebarCollapsed]);

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
    </div>
  );
}
