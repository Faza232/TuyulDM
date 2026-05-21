import { useState } from 'react';
import { Search, Plus, Menu as MenuIcon, MoreHorizontal, Monitor } from '../../ui/icons';
import { Button, IconButton, Input, Toolbar, ToolbarSpacer, Kbd, Menu } from '../../ui/primitives';
import type { AppRoute } from './Sidebar';

interface TopBarProps {
  activeRoute: AppRoute;
  onAddUrl: () => void;
  onSearch: (q: string) => void;
  toggleSidebar: () => void;
}

const routeTitles: Record<AppRoute, string> = {
  queue: 'Active Downloads',
  finished: 'Finished',
  grabber: 'Video Grabber',
  logs: 'System Logs',
  settings: 'Settings'
};

export function TopBar({ activeRoute, onAddUrl, onSearch, toggleSidebar }: TopBarProps) {
  const [density, setDensity] = useState<'cozy' | 'compact'>('cozy');

  return (
    <Toolbar ariaLabel="Main toolbar">
      <IconButton icon={<MenuIcon />} aria-label="Toggle sidebar" onClick={toggleSidebar} />
      <div className="flex items-center gap-2 ml-2">
        <span className="font-bold text-[var(--color-text)]">TuyulDM</span>
        <span className="text-[var(--color-text-dim)]">/</span>
        <span className="text-[var(--color-text-muted)]">{routeTitles[activeRoute]}</span>
      </div>
      
      <ToolbarSpacer />
      
      <div className="relative flex items-center w-64 mr-2">
        <Input 
          className="w-full"
          iconLeft={<Search />}
          placeholder="Search..." 
          onChange={(e) => onSearch(e.target.value)}
        />
        <div className="absolute right-2 flex items-center pointer-events-none">
          <Kbd>⌘K</Kbd>
        </div>
      </div>
      
      <Menu 
        groups={[
          {
            id: 'view',
            items: [
              {
                id: 'density',
                label: `Density: ${density === 'cozy' ? 'Compact' : 'Cozy'}`,
                icon: <Monitor />,
                onSelect: () => setDensity(d => d === 'cozy' ? 'compact' : 'cozy')
              }
            ]
          }
        ]}
        trigger={<IconButton icon={<MoreHorizontal />} aria-label="Options" />}
      />

      <Button variant="primary" size="sm" onClick={onAddUrl}>
        <Plus className="size-4 mr-1" /> Add URL
      </Button>
    </Toolbar>
  );
}
