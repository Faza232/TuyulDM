import { useState } from 'react';
import { Search, Plus, Menu as MenuIcon, MoreHorizontal, Monitor } from '../../ui/icons';
import { Button, IconButton, Input, Toolbar, ToolbarSpacer, Kbd, Menu } from '../../ui/primitives';
import type { AppRoute } from './Sidebar';
import { useCommands } from '../../state/commands';

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
  const { setOpen: setPaletteOpen } = useCommands();

  return (
    <Toolbar ariaLabel="Main toolbar">
      <IconButton label="Toggle sidebar" onClick={toggleSidebar}>
        <MenuIcon />
      </IconButton>
      <div className="flex items-center gap-2 ml-2">
        <span className="font-bold text-[var(--color-text)]">TuyulDM</span>
        <span className="text-[var(--color-text-dim)]">/</span>
        <span className="text-[var(--color-text-muted)]">{routeTitles[activeRoute]}</span>
      </div>
      
      <ToolbarSpacer />
      
      <div 
        className="relative flex items-center w-64 mr-2 group cursor-pointer"
        onClick={() => setPaletteOpen(true)}
      >
        <Input 
          className="w-full pointer-events-none"
          iconLeft={<Search />}
          placeholder="Command palette..." 
          readOnly
          tabIndex={-1}
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
        trigger={
          <IconButton label="Options">
            <MoreHorizontal />
          </IconButton>
        }
      />

      <Button variant="primary" size="sm" onClick={onAddUrl}>
        <Plus className="size-4 mr-1" /> Add URL
      </Button>
    </Toolbar>
  );
}
