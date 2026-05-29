import { createContext, useContext } from 'react';
import type { DownloadItem } from '../../state/types';
import type { RecoveryAction } from '../../state/messages';
import type { Density } from '../../ui/tokens';

export type DashboardRoute = 'queue' | 'finished' | 'grabber' | 'logs';

export interface DashboardContextValue {
  route: DashboardRoute;
  navigate: (route: DashboardRoute) => void;
  density: Density;
  search: string;
  // selection
  selection: Set<string>;
  isSelected: (id: number | string) => boolean;
  onSelectRow: (e: React.MouseEvent, d: DownloadItem, visible: DownloadItem[]) => void;
  clearSelection: () => void;
  // row actions
  openDrawer: (d: DownloadItem) => void;
  togglePlayPause: (d: DownloadItem) => void;
  cancel: (d: DownloadItem) => void;
  openFile: (d: DownloadItem) => void;
  reveal: (d: DownloadItem) => void;
  openSource: (d: DownloadItem) => void;
  recover: (action: RecoveryAction, d: DownloadItem) => void;
  openContextMenu: (e: React.MouseEvent, d: DownloadItem) => void;
  openAddUrl: () => void;
}

export const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used within Dashboard');
  return ctx;
}
