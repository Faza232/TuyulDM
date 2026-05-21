import { Download, CheckCircle2, Video, FileText, Settings } from '../../ui/icons';
import { Sidebar as SidebarPrimitive, SidebarSection, SidebarItem } from '../../ui/primitives';

export type AppRoute = 'queue' | 'finished' | 'grabber' | 'logs' | 'settings';

interface AppSidebarProps {
  collapsed: boolean;
  activeRoute: AppRoute;
  onRouteChange: (route: AppRoute) => void;
  counts?: { queue?: number; finished?: number; grabber?: number };
}

export function AppSidebar({ collapsed, activeRoute, onRouteChange, counts }: AppSidebarProps) {
  return (
    <SidebarPrimitive collapsed={collapsed}>
      <SidebarSection label="Queue" collapsed={collapsed}>
        <SidebarItem
          icon={<Download />}
          label="All Active"
          active={activeRoute === 'queue'}
          onClick={() => onRouteChange('queue')}
          count={counts?.queue}
          collapsed={collapsed}
        />
        <SidebarItem
          icon={<CheckCircle2 />}
          label="Finished"
          active={activeRoute === 'finished'}
          onClick={() => onRouteChange('finished')}
          count={counts?.finished}
          collapsed={collapsed}
        />
      </SidebarSection>
      <SidebarSection label="Discover" collapsed={collapsed}>
        <SidebarItem
          icon={<Video />}
          label="Grabber"
          active={activeRoute === 'grabber'}
          onClick={() => onRouteChange('grabber')}
          count={counts?.grabber}
          collapsed={collapsed}
        />
      </SidebarSection>
      <SidebarSection label="System" collapsed={collapsed} className="mt-auto">
        <SidebarItem
          icon={<FileText />}
          label="Logs"
          active={activeRoute === 'logs'}
          onClick={() => onRouteChange('logs')}
          collapsed={collapsed}
        />
        <SidebarItem
          icon={<Settings />}
          label="Settings"
          active={activeRoute === 'settings'}
          onClick={() => window.open(chrome.runtime.getURL('options.html'), '_blank')}
          collapsed={collapsed}
        />
      </SidebarSection>
    </SidebarPrimitive>
  );
}
