import { Row, ProgressBar } from '../../../ui/primitives';
import { StrategyChip } from './StrategyChip';
import { AssemblyStageBadge } from './AssemblyStageBadge';
import { RefusalCell } from './RefusalCell';
import type { DownloadItem } from '../../../state/types';

function formatSize(bytes: number | string) {
  if (typeof bytes === 'string') return bytes;
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

interface DownloadRowProps {
  download: DownloadItem;
  density: 'cozy' | 'compact';
  selected: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onAction: (type: string, url?: string) => void;
}

export function DownloadRow({ download, density, selected, onClick, onContextMenu, onAction }: DownloadRowProps) {
  const isError = download.status === 'error' || download.status === 'awaiting_url_refresh';
  const isProtected = download.extraction_strategy === 'unsupported_protected';
  
  const showRefusal = isError || isProtected;

  return (
    <div className="relative mb-1">
      <Row 
        density={density} 
        selected={selected} 
        interactive={!isProtected} 
        onClick={isProtected ? undefined : onClick}
        onContextMenu={onContextMenu}
        className={isProtected || isError ? 'opacity-80' : ''}
      >
        <div className="w-[100px] shrink-0">
          <StrategyChip strategy={download.extraction_strategy} />
        </div>
        
        <div className="flex-1 flex flex-col min-w-0 pr-4 justify-center">
          <span className="truncate font-medium leading-tight">
            {download.name || download.filename || download.offer_title || `Download ${download.id}`}
          </span>
          <span className="truncate text-xs text-[var(--color-text-dim)] leading-tight mt-0.5">
            {new URL(download.url || 'http://localhost').hostname} • {download.plan?.final_container || 'Unknown'}
          </span>
        </div>

        {showRefusal ? (
          <div className="flex-1 flex items-center justify-end">
            <RefusalCell reason={download.error_code || download.extraction_strategy || download.error} onAction={onAction} />
          </div>
        ) : (
          <>
            <div className="w-[80px] shrink-0 text-right font-mono text-xs text-[var(--color-text-dim)]">
              {formatSize(download.total_size || download.size || 0)}
            </div>
            
            <div className="w-[80px] shrink-0 text-right font-mono text-xs text-[var(--color-text-dim)]">
              {download.status === 'downloading' || download.status === 'muxing' ? `${formatSize(download.speed_bytes_per_second || 0)}/s` : download.status}
            </div>

            <div className="w-[60px] shrink-0 text-right font-mono text-xs">
              {download.progress > 0 ? `${Math.round(download.progress)}%` : '-'}
            </div>

            <div className="w-[100px] shrink-0 text-right flex justify-end">
              {(download.status === 'downloading' || download.status === 'muxing') && download.assembly_stage && (
                <AssemblyStageBadge stage={download.assembly_stage} />
              )}
            </div>
          </>
        )}
      </Row>
      {(download.status === 'downloading' || download.status === 'muxing' || download.status === 'paused') && !showRefusal && (
        <div className="absolute bottom-0 left-[112px] right-0 translate-y-[2px]">
          <ProgressBar value={download.progress} className="h-[2px] bg-transparent" />
        </div>
      )}
    </div>
  );
}
