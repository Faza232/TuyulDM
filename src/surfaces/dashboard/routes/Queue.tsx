import { useState, useEffect } from 'react';
import { useDownloads } from '../../../state';
import { useCommands } from '../../../state/commands';
import { useShortcuts } from '../../../state/shortcuts';
import { EmptyState } from '../../../ui/primitives';
import { Download as QueueIcon } from '../../../ui/icons';
import { DownloadRow } from '../components/DownloadRow';
import { DownloadDetailsDrawer } from '../components/DownloadDetailsDrawer';
import type { DownloadItem } from '../../../state/types';

export default function QueueRoute() {
  const { downloads, refreshUrl, pause, resume, cancel } = useDownloads();
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [detailsId, setDetailsId] = useState<string | number | null>(null);
  
  const { registerCommands } = useCommands();

  const activeDownloads = downloads.filter(d => 
    ['downloading', 'queued', 'muxing', 'error', 'paused', 'awaiting_url_refresh'].includes(d.status)
  );

  const selectedDownload = downloads.find(d => d.id === detailsId) || null;
  const focusedDownload = downloads.find(d => d.id === selectedId) || null;

  useEffect(() => {
    return registerCommands([
      { 
        id: 'queue:pause-all', 
        label: 'Pause all downloads', 
        group: 'Queue', 
        onSelect: () => activeDownloads.forEach(d => { if (d.status === 'downloading') pause(d.id); }) 
      },
      { 
        id: 'queue:resume-all', 
        label: 'Resume all downloads', 
        group: 'Queue', 
        onSelect: () => activeDownloads.forEach(d => { if (d.status === 'paused') resume(d.id); }) 
      },
      { 
        id: 'queue:cancel-all', 
        label: 'Cancel all downloads', 
        group: 'Queue', 
        onSelect: () => activeDownloads.forEach(d => cancel(d.id)) 
      }
    ]);
  }, [activeDownloads, pause, resume, cancel, registerCommands]);

  useShortcuts([
    {
      key: 'Enter',
      description: 'Open details drawer',
      handler: () => {
        if (selectedId && focusedDownload && !['error', 'awaiting_url_refresh'].includes(focusedDownload.status) && focusedDownload.extraction_strategy !== 'unsupported_protected') {
          setDetailsId(selectedId);
        }
      }
    },
    {
      key: ' ', // Space
      description: 'Pause/resume focused row',
      handler: (e) => {
        if (focusedDownload && ['downloading', 'paused'].includes(focusedDownload.status)) {
          e.preventDefault();
          if (focusedDownload.status === 'downloading') pause(focusedDownload.id);
          else resume(focusedDownload.id);
        }
      }
    },
    {
      key: 'Delete',
      description: 'Cancel focused row',
      handler: () => {
        if (selectedId && confirm('Cancel selected download?')) {
          cancel(selectedId);
          setSelectedId(null);
        }
      }
    }
  ]);

  useEffect(() => {
    if (focusedDownload) {
      const dynamicCommands = [
        focusedDownload.status === 'downloading'
          ? { id: 'row:pause', label: `Pause: ${focusedDownload.filename || 'Download'}`, group: 'Actions', onSelect: () => pause(focusedDownload.id) }
          : { id: 'row:resume', label: `Resume: ${focusedDownload.filename || 'Download'}`, group: 'Actions', onSelect: () => resume(focusedDownload.id) },
        { id: 'row:folder', label: `Open folder: ${focusedDownload.filename || 'Download'}`, group: 'Actions', onSelect: () => handleOpenFolder(focusedDownload.id) }
      ];
      const cleanup = registerCommands(dynamicCommands);
      return cleanup;
    }
  }, [focusedDownload, pause, resume, registerCommands]);

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
          action={<button onClick={() => alert("TODO")} className="text-[var(--color-accent)] hover:underline">Add URL</button>}
        />
      </div>
    );
  }

  return (
    <div className="p-4 h-full overflow-y-auto">
      <div className="flex flex-col gap-1 max-w-5xl mx-auto">
        {activeDownloads.map((d) => (
          <div key={d.id} onDoubleClick={() => {
             if (!['error', 'awaiting_url_refresh'].includes(d.status) && d.extraction_strategy !== 'unsupported_protected') {
                setDetailsId(d.id);
             }
          }}>
            <DownloadRow
              download={d as DownloadItem}
              density="cozy"
              selected={selectedId === d.id}
              onClick={() => {
                setSelectedId(d.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setSelectedId(d.id);
              }}
              onAction={handleAction}
            />
          </div>
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
