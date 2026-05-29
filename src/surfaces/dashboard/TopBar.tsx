import { useState } from 'react';
import { Toolbar, Button, Input, Kbd, IconButton, Menu, Badge } from '../../ui/primitives';
import type { MenuItem } from '../../ui/primitives';
import { Plus, Search, MoreVertical, Pause, Play, Trash2, FolderOpen } from '../../ui/icons';
import type { DashboardRoute } from './context';
import type { Density } from '../../ui/tokens';
import { formatSpeed } from '../../ui/format';

const ROUTE_LABEL: Record<DashboardRoute, string> = {
  queue: 'Queue',
  finished: 'Finished',
  grabber: 'Video Grabber',
  logs: 'Logs',
};

export type TopBarProps = {
  route: DashboardRoute;
  search: string;
  onSearch: (v: string) => void;
  onAddUrl: () => void;
  onOpenPalette: () => void;
  density: Density;
  setDensity: (d: Density) => void;
  globalSpeed: number;
  selectionCount: number;
  onBulk: (action: 'pause' | 'resume' | 'cancel' | 'folder') => void;
  onClearSelection: () => void;
};

export function TopBar(props: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const overflow: MenuItem[] = [
    { label: props.density === 'compact' ? 'Density: Cozy' : 'Density: Compact', onSelect: () => props.setDensity(props.density === 'compact' ? 'cozy' : 'compact') },
  ];

  if (props.selectionCount > 0) {
    return (
      <Toolbar>
        <div className="flex items-center gap-2">
          <Badge tone="accent">{props.selectionCount} selected</Badge>
          <Button size="sm" variant="secondary" iconLeft={<Pause size={13} />} onClick={() => props.onBulk('pause')}>Pause</Button>
          <Button size="sm" variant="secondary" iconLeft={<Play size={13} />} onClick={() => props.onBulk('resume')}>Resume</Button>
          <Button size="sm" variant="secondary" iconLeft={<FolderOpen size={13} />} onClick={() => props.onBulk('folder')}>Folder</Button>
          <Button size="sm" variant="danger" iconLeft={<Trash2 size={13} />} onClick={() => props.onBulk('cancel')}>Cancel</Button>
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={props.onClearSelection}>Clear</Button>
      </Toolbar>
    );
  }

  return (
    <Toolbar
      left={<span className="text-[13px] font-medium text-[var(--color-text)]">{ROUTE_LABEL[props.route]}</span>}
      center={
        <Input
          iconLeft={<Search size={14} />}
          placeholder="Search downloads…"
          value={props.search}
          onChange={(e) => props.onSearch(e.target.value)}
          className="w-full max-w-md"
        />
      }
      right={
        <>
          {props.globalSpeed > 0 && (
            <span className="hidden lg:inline font-mono text-[11px] text-[var(--color-text-muted)]">{formatSpeed(props.globalSpeed)}</span>
          )}
          <button
            onClick={props.onOpenPalette}
            className="hidden sm:inline-flex items-center gap-1 px-1.5 h-7 rounded-[var(--radius-sm)] hover:bg-white/5"
          >
            <Kbd>⌘K</Kbd>
          </button>
          <Button size="sm" variant="primary" iconLeft={<Plus size={14} />} onClick={props.onAddUrl}>Add URL</Button>
          <span className="relative">
            <IconButton size="sm" icon={<MoreVertical size={16} />} label="More" onClick={() => setMenuOpen((o) => !o)} />
            <Menu open={menuOpen} onClose={() => setMenuOpen(false)} items={overflow} />
          </span>
        </>
      }
    />
  );
}
