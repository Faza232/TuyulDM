import { useMemo } from 'react';
import { EmptyState, Button } from '../../../ui/primitives';
import { Download, Plus } from '../../../ui/icons';
import { DownloadRow } from '../components/DownloadRow';
import { useDashboard } from '../context';
import { useDownloads } from '../../../state/store';
import { getDownloadLabel, hostFromUrl } from '../../../ui/format';
import type { DownloadItem } from '../../../state/types';

const ACTIVE = new Set(['downloading', 'queued', 'muxing', 'paused', 'awaiting_url_refresh', 'error']);

function matchesSearch(d: DownloadItem, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    getDownloadLabel(d).toLowerCase().includes(needle) ||
    (d.offer_title || '').toLowerCase().includes(needle) ||
    hostFromUrl(d.url).toLowerCase().includes(needle)
  );
}

export function Queue({ filter }: { filter: 'all' | 'active' }) {
  const dash = useDashboard();
  const { downloads } = useDownloads();

  const visible = useMemo(() => {
    let list = filter === 'active' ? downloads.filter((d) => ACTIVE.has(d.status)) : downloads;
    if (dash.search) list = list.filter((d) => matchesSearch(d, dash.search));
    return list;
  }, [downloads, filter, dash.search]);

  if (visible.length === 0) {
    return (
      <EmptyState
        icon={<Download size={28} />}
        title="Queue is empty"
        body="Add a URL or grab media from the current tab to start downloading."
        action={<Button variant="primary" size="sm" iconLeft={<Plus size={14} />} onClick={dash.openAddUrl}>Add URL</Button>}
      />
    );
  }

  return (
    <div className="p-3 space-y-0.5">
      {visible.map((d: DownloadItem) => (
        <DownloadRow
          key={d.id}
          download={d}
          density={dash.density}
          selected={dash.isSelected(d.id)}
          onSelect={(e, dl) => dash.onSelectRow(e, dl, visible)}
          onOpen={dash.openDrawer}
          onTogglePlayPause={dash.togglePlayPause}
          onCancel={dash.cancel}
          onOpenFile={dash.openFile}
          onReveal={dash.reveal}
          onOpenSource={dash.openSource}
          onRecover={dash.recover}
          onContextMenu={dash.openContextMenu}
        />
      ))}
    </div>
  );
}
