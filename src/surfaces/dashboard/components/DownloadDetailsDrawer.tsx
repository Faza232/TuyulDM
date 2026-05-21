import { Drawer, Button, IconButton, Chip } from '../../../ui/primitives';
import { FolderOpen, Copy } from '../../../ui/icons';
import type { DownloadItem } from '../../../state/types';

interface DownloadDetailsDrawerProps {
  download: DownloadItem | null;
  open: boolean;
  onClose: () => void;
  onOpenFolder: (id: string | number) => void;
  onRefreshUrl: (id: string | number) => void;
}

export function DownloadDetailsDrawer({ download, open, onClose, onOpenFolder, onRefreshUrl }: DownloadDetailsDrawerProps) {
  if (!download) return null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={download.name || download.filename || `Download ${download.id}`}
      width={480}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {(download.status === 'downloading' || download.status === 'muxing') && (
            <Button variant="danger">Cancel</Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <div className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-text-dim)]">Output</div>
          <div className="flex items-center justify-between text-[13px] bg-[var(--color-surface-raised)] border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)] p-2">
            <span className="truncate flex-1 font-mono text-[var(--color-text-muted)] text-[11px]">{download.output_path || 'Unknown output directory'}</span>
            <IconButton label="Open Folder" onClick={() => onOpenFolder(download.id)} size="sm">
              <FolderOpen className="size-3.5" />
            </IconButton>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <div className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-text-dim)]">Strategy & Plan</div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-[11px] text-[var(--color-text-dim)] block mb-1">Strategy</span>
              <Chip tone="accent">{download.extraction_strategy || 'Unknown'}</Chip>
            </div>
            <div>
              <span className="text-[11px] text-[var(--color-text-dim)] block mb-1">Assembly Stage</span>
              <span className="text-[13px] text-[var(--color-text)]">{download.assembly_stage || 'Not started'}</span>
            </div>
            {download.site_key && (
              <div>
                <span className="text-[11px] text-[var(--color-text-dim)] block mb-1">Site Key</span>
                <span className="text-[13px] text-[var(--color-text)]">{download.site_key}</span>
              </div>
            )}
            {download.plan?.final_container && (
              <div>
                <span className="text-[11px] text-[var(--color-text-dim)] block mb-1">Final Container</span>
                <span className="text-[13px] text-[var(--color-text)]">{download.plan.final_container}</span>
              </div>
            )}
            {download.track_count !== undefined && (
              <div>
                <span className="text-[11px] text-[var(--color-text-dim)] block mb-1">Tracks</span>
                <span className="text-[13px] text-[var(--color-text)]">{download.track_count} extracted</span>
              </div>
            )}
          </div>
        </section>

        {download.offer_debug?.expires_at && (
          <section className="flex flex-col gap-2">
            <div className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-text-dim)]">Expiry</div>
            <div className="flex items-center justify-between text-[13px] bg-[var(--color-surface-raised)] border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)] p-2">
              <div className="flex flex-col">
                <span className="font-medium text-[var(--color-text)]">Link expires at</span>
                <span className="text-[11px] text-[var(--color-text-dim)]">{new Date(download.offer_debug.expires_at).toLocaleString()}</span>
              </div>
              <Button variant="secondary" size="sm" onClick={() => onRefreshUrl(download.id)}>Refresh from tab</Button>
            </div>
          </section>
        )}

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-text-dim)]">Debug Payload</div>
            <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(JSON.stringify(download, null, 2))}>
              <Copy className="size-3 mr-1" /> Copy Safe JSON
            </Button>
          </div>
          <pre className="text-[11px] font-mono p-3 bg-[var(--color-surface-raised)] border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)] overflow-x-auto text-[var(--color-text-muted)]">
            {JSON.stringify({
              id: download.id,
              strategy: download.extraction_strategy,
              stage: download.assembly_stage,
              plan: download.plan,
              debug: download.offer_debug,
              status: download.status,
              error: download.error_code || download.error
            }, null, 2)}
          </pre>
        </section>
      </div>
    </Drawer>
  );
}
