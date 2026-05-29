import type { ReactNode } from 'react';
import type { DownloadItem } from './types';
import { getDownloadLabel } from '../ui/format';

export interface Command {
  id: string;
  title: string;
  subtitle?: string;
  group: string;
  icon?: ReactNode;
  run: () => void;
}

export interface CommandContext {
  navigate: (route: string) => void;
  pauseAll: () => void;
  resumeAll: () => void;
  cancelAll: () => void;
  addUrl: () => void;
  scanTab: () => void;
  openDownloadFolder: () => void;
  openLogs: () => void;
  openSettings: () => void;
  toggleSidebar: () => void;
  setDensity: (d: 'compact' | 'cozy') => void;
  downloads: DownloadItem[];
  pause: (id: number | string) => void;
  revealInFolder: (id: number | string) => void;
}

export function buildCommands(ctx: CommandContext): Command[] {
  const base: Command[] = [
    { id: 'queue.pauseAll', title: 'Queue: pause all', group: 'Queue', run: ctx.pauseAll },
    { id: 'queue.resumeAll', title: 'Queue: resume all', group: 'Queue', run: ctx.resumeAll },
    { id: 'queue.cancelAll', title: 'Queue: cancel all', group: 'Queue', run: ctx.cancelAll },
    { id: 'add', title: 'Add URL…', group: 'Actions', run: ctx.addUrl },
    { id: 'scan', title: 'Scan current tab', group: 'Actions', run: ctx.scanTab },
    { id: 'openFolder', title: 'Open download folder', group: 'Actions', run: ctx.openDownloadFolder },
    { id: 'nav.queue', title: 'Go to Queue', group: 'Navigation', run: () => ctx.navigate('queue') },
    { id: 'nav.finished', title: 'Go to Finished', group: 'Navigation', run: () => ctx.navigate('finished') },
    { id: 'nav.grabber', title: 'Go to Grabber', group: 'Navigation', run: () => ctx.navigate('grabber') },
    { id: 'nav.logs', title: 'Open logs', group: 'Navigation', run: ctx.openLogs },
    { id: 'nav.settings', title: 'Open settings', group: 'Navigation', run: ctx.openSettings },
    { id: 'view.toggleSidebar', title: 'Toggle sidebar', group: 'View', run: ctx.toggleSidebar },
    { id: 'view.compact', title: 'Switch density: compact', group: 'View', run: () => ctx.setDensity('compact') },
    { id: 'view.cozy', title: 'Switch density: cozy', group: 'View', run: () => ctx.setDensity('cozy') },
  ];

  const perDownload: Command[] = ctx.downloads.flatMap((d) => {
    const label = getDownloadLabel(d);
    const cmds: Command[] = [];
    if (d.status === 'downloading' || d.status === 'queued') {
      cmds.push({ id: `pause.${d.id}`, title: `Pause ${label}`, subtitle: 'Download', group: 'Downloads', run: () => ctx.pause(d.id) });
    }
    if (d.output_path) {
      cmds.push({ id: `folder.${d.id}`, title: `Open folder for ${label}`, subtitle: 'Download', group: 'Downloads', run: () => ctx.revealInFolder(d.id) });
    }
    return cmds;
  });

  return [...base, ...perDownload];
}

// Lightweight fuzzy match: returns score (higher = better) or -1 for no match.
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let lastIdx = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += lastIdx === ti - 1 ? 3 : 1; // contiguous bonus
      lastIdx = ti;
      qi++;
    }
  }
  return qi === q.length ? score : -1;
}
