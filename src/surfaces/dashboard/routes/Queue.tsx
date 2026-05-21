import { useState } from 'react';
import { useDownloads } from '../../../state';
import { EmptyState } from '../../../ui/primitives';
import { Download as QueueIcon } from '../../../ui/icons';
import { DownloadRow } from '../components/DownloadRow';
import { DownloadDetailsDrawer } from '../components/DownloadDetailsDrawer';
import type { DownloadItem } from '../../../state/types';

export default function QueueRoute() {
  const { downloads, refreshUrl } = useDownloads();
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [detailsId, setDetailsId] = useState<string | number | null>(null);

  const activeDownloads = downloads.filter(d => 
    ['downloading', 'queued', 'muxing', 'error', 'paused', 'awaiting_url_refresh'].includes(d.status)
  );

  const selectedDownload = downloads.find(d => d.id === detailsId) || null;

  const handleAction = (type: string, url?: string) => {
    if (type === 'tab_refresh' && url) {
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        chrome.tabs.create({ url, active: false });
      } else {
        window.open(url, '_blank');
      }
    }
  };

  const handleOpenFolder = (id: string | number) => {
    console.log('Open folder for', id);
    // TODO: implement call via bridge
  };

  const handleRefreshUrl = (id: string | number) => {
    refreshUrl(id);
  };

  if (activeDownloads.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <EmptyState
          icon={<QueueIcon className="size-8" />}
          title="Queue is empty"
          action={<button onClick={() => alert("TODO")} className="text-blue-500 hover:underline">Add URL</button>}
        />
      </div>
    );
  }

  return (
    <div className="p-4 h-full overflow-y-auto">
      <div className="flex flex-col gap-1 max-w-5xl mx-auto">
        {activeDownloads.map((d) => (
          <DownloadRow
            key={d.id}
            download={d as DownloadItem}
            density="cozy"
            selected={selectedId === d.id}
            onClick={() => {
              setSelectedId(d.id);
              if (!['error', 'awaiting_url_refresh'].includes(d.status) && d.extraction_strategy !== 'unsupported_protected') {
                setDetailsId(d.id);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setSelectedId(d.id);
            }}
            onAction={handleAction}
          />
        ))}
      </div>

      <DownloadDetailsDrawer
        download={selectedDownload as DownloadItem | null}
        open={detailsId !== null}
        onClose={() => setDetailsId(null)}
        onOpenFolder={handleOpenFolder}
        onRefreshUrl={handleRefreshUrl}
      />
    </div>
  );
}
