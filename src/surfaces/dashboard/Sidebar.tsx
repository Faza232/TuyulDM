import { Sidebar as SidebarShell, SidebarItem, IconButton } from '../../ui/primitives';
import { LayoutGrid, ListChecks, CheckCircle2, Film, Activity, Settings, Info, PanelLeftClose, PanelLeftOpen } from '../../ui/icons';
import type { DashboardRoute } from './context';

export type DashboardSidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
  route: DashboardRoute;
  navigate: (route: DashboardRoute) => void;
  counts: { all: number; active: number; finished: number };
  onOpenSettings: () => void;
  onAbout: () => void;
};

function GroupLabel({ collapsed, children }: { collapsed: boolean; children: string }) {
  if (collapsed) return <div className="h-2" />;
  return <div className="px-4 pt-3 pb-1 font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-dim)]">{children}</div>;
}

export function DashboardSidebar({ collapsed, onToggle, route, navigate, counts, onOpenSettings, onAbout }: DashboardSidebarProps) {
  return (
    <SidebarShell collapsed={collapsed}>
      <div className="h-12 flex items-center justify-between px-3 border-b border-[var(--color-border-subtle)] shrink-0">
        {!collapsed && <span className="font-mono text-[13px] text-[var(--color-text)]">TuyulDM</span>}
        <IconButton
          size="sm"
          tooltip={false}
          icon={collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          label="Toggle sidebar"
          onClick={onToggle}
        />
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        <GroupLabel collapsed={collapsed}>Queue</GroupLabel>
        <SidebarItem icon={<LayoutGrid size={16} />} label="All" count={counts.all} active={route === 'queue'} collapsed={collapsed} onClick={() => navigate('queue')} />
        <SidebarItem icon={<ListChecks size={16} />} label="Active" count={counts.active} active={false} collapsed={collapsed} onClick={() => navigate('queue')} />
        <SidebarItem icon={<CheckCircle2 size={16} />} label="Finished" count={counts.finished} active={route === 'finished'} collapsed={collapsed} onClick={() => navigate('finished')} />

        <GroupLabel collapsed={collapsed}>Discover</GroupLabel>
        <SidebarItem icon={<Film size={16} />} label="Video Grabber" active={route === 'grabber'} collapsed={collapsed} onClick={() => navigate('grabber')} />

        <GroupLabel collapsed={collapsed}>System</GroupLabel>
        <SidebarItem icon={<Activity size={16} />} label="Logs" active={route === 'logs'} collapsed={collapsed} onClick={() => navigate('logs')} />
        <SidebarItem icon={<Settings size={16} />} label="Settings" collapsed={collapsed} onClick={onOpenSettings} />
        <SidebarItem icon={<Info size={16} />} label="About" collapsed={collapsed} onClick={onAbout} />
      </div>
    </SidebarShell>
  );
}
