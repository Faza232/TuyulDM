import { useState } from 'react';
import { Row, ProgressBar, IconButton, Menu, Checkbox } from '../../../ui/primitives';
import type { MenuItem } from '../../../ui/primitives';
import { MoreHorizontal, Pause, Play, Trash2, FolderOpen, FileIcon, ExternalLink } from '../../../ui/icons';
import { StrategyChip } from './StrategyChip';
import { AssemblyStageBadge } from './AssemblyStageBadge';
import { RefusalCell } from './RefusalCell';
import type { DownloadItem } from '../../../state/types';
import type { Density } from '../../../ui/tokens';
import type { RecoveryAction } from '../../../state/messages';
import { formatSize, formatDownloadSpeed, getDownloadLabel, hostFromUrl, downloadNeedsUrlRefresh } from '../../../ui/format';

export type DownloadRowActions = {
  onOpen: (d: DownloadItem) => void;
  onTogglePlayPause: (d: DownloadItem) => void;
  onCancel: (d: DownloadItem) => void;
  onOpenFile: (d: DownloadItem) => void;
  onReveal: (d: DownloadItem) => void;
  onOpenSource: (d: DownloadItem) => void;
  onRecover: (action: RecoveryAction, d: DownloadItem) => void;
  onContextMenu: (e: React.MouseEvent, d: DownloadItem) => void;
};

export type DownloadRowProps = DownloadRowActions & {
  download: DownloadItem;
  density: Density;
  selected: boolean;
  onSelect: (e: React.MouseEvent, d: DownloadItem) => void;
};

const ACTIVE = new Set(['downloading', 'queued', 'muxing']);

export function DownloadRow(props: DownloadRowProps) {
  const { download: d, density, selected, onSelect, onOpen, onTogglePlayPause, onCancel, onOpenFile, onReveal, onOpenSource, onRecover, onContextMenu } = props;
  const [menuOpen, setMenuOpen] = useState(false);

  const isProtected = d.extraction_strategy === 'unsupported_protected';
  const isRefusal = isProtected || d.status === 'error';
  const isActive = ACTIVE.has(d.status);
  const isDownloading = d.status === 'downloading';
  const needsRefresh = downloadNeedsUrlRefresh(d);
  const label = getDownloadLabel(d);
  const pct = Math.round((d.progress || 0));

  const menuItems: MenuItem[] = isProtected
    ? [
        { label: 'Open source page', icon: <ExternalLink size={14} />, onSelect: () => onOpenSource(d), disabled: !d.offer_debug?.page_url && !d.url },
        { label: 'Open documentation', icon: <ExternalLink size={14} />, onSelect: () => onRecover({ kind: 'OpenDocs', url: 'https://github.com/husainfaza/TuyulDM#troubleshooting' }, d) },
      ]
    : [
        { label: isActive ? 'Pause' : 'Resume', icon: isActive ? <Pause size={14} /> : <Play size={14} />, onSelect: () => onTogglePlayPause(d) },
        { label: 'Open file', icon: <FileIcon size={14} />, onSelect: () => onOpenFile(d), disabled: d.status !== 'finished' },
        { label: 'Open folder', icon: <FolderOpen size={14} />, onSelect: () => onReveal(d), disabled: !d.output_path },
        { label: 'Open source page', icon: <ExternalLink size={14} />, onSelect: () => onOpenSource(d), disabled: !d.url },
        { type: 'separator' },
        { label: 'Cancel', tone: 'danger', icon: <Trash2 size={14} />, onSelect: () => onCancel(d) },
      ];

  return (
    <Row
      density={density}
      selected={selected}
      onClick={() => onOpen(d)}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, d); }}
      className={isProtected ? 'opacity-70' : undefined}
    >
      <span onClick={(e) => { e.stopPropagation(); }} className="shrink-0">
        <Checkbox checked={selected} onChange={() => {}} onClick={(e) => onSelect(e as unknown as React.MouseEvent, d)} />
      </span>

      <span className="shrink-0"><StrategyChip strategy={d.extraction_strategy} /></span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13px] text-[var(--color-text)] truncate">{d.offer_title || label}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-dim)] truncate">
          <span className="truncate">{hostFromUrl(d.url) || d.site_key || '—'}</span>
          {d.track_count ? <span>· {d.track_count} tracks</span> : null}
          {needsRefresh && <span className="text-[var(--color-warning)]">· link expired</span>}
        </div>
        {isDownloading && <div className="mt-1.5 max-w-[260px]"><ProgressBar value={(d.progress || 0) / 100} /></div>}
      </div>

      {isRefusal ? (
        <RefusalCell download={d} onRecover={onRecover} />
      ) : (
        <>
          <span className="hidden md:block w-20 text-right font-mono text-[12px] text-[var(--color-text-muted)] shrink-0">
            {d.total_size ? formatSize(d.total_size) : d.size || '—'}
          </span>
          <span className="hidden lg:block w-24 text-right font-mono text-[12px] text-[var(--color-text-muted)] shrink-0">
            {isActive ? formatDownloadSpeed(d) : ''}
          </span>
          <span className="w-12 text-right font-mono text-[12px] text-[var(--color-text)] shrink-0">
            {d.status === 'finished' ? '100%' : `${pct}%`}
          </span>
          <span className="w-24 flex justify-end shrink-0"><AssemblyStageBadge stage={d.assembly_stage} /></span>
        </>
      )}

      <span className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
        <IconButton icon={<MoreHorizontal size={16} />} label="Actions" size="sm" onClick={() => setMenuOpen((o) => !o)} />
        <Menu open={menuOpen} onClose={() => setMenuOpen(false)} items={menuItems} />
      </span>
    </Row>
  );
}
