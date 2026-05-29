import { Badge, Button, IconButton } from '../../../ui/primitives';
import { Download, ExternalLink, Copy, Lock, ScanLine } from '../../../ui/icons';
import { PosterPreview } from './PosterPreview';
import type { DetectedStreamItem } from '../../../state/types';
import { hostFromUrl } from '../../../ui/format';
import { cn } from '../../../ui/cn';

export type DetectedOfferCardProps = {
  stream: DetectedStreamItem;
  selected?: boolean;
  compact?: boolean;
  busy?: boolean;
  onFocus?: (s: DetectedStreamItem) => void;
  onReview?: (s: DetectedStreamItem) => void;
  onDownload: (s: DetectedStreamItem) => void;
  onCopyUrl: (s: DetectedStreamItem) => void;
  onOpenPage: (s: DetectedStreamItem) => void;
};

function manifestTone(s: DetectedStreamItem) {
  if (s.protected) return 'warning' as const;
  if (s.manifestType) return 'accent' as const;
  return 'neutral' as const;
}

export function DetectedOfferCard(props: DetectedOfferCardProps) {
  const { stream: s, selected, compact, busy, onFocus, onReview, onDownload, onCopyUrl, onOpenPage } = props;

  return (
    <div
      onClick={() => onFocus?.(s)}
      className={cn(
        'rounded-[var(--radius-md)] border transition-colors duration-[var(--motion-fast)]',
        onFocus && 'cursor-pointer',
        selected ? 'bg-[var(--color-surface-raised)] border-[var(--color-border)]' : 'border-[var(--color-border-subtle)] hover:border-[var(--color-border)]',
        compact ? 'p-2' : 'p-3',
      )}
    >
      <div className={cn('flex gap-3', compact && 'items-center')}>
        {!compact && <PosterPreview src={s.posterUrl} className="w-28 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1">
            <Badge tone={manifestTone(s)}>
              {s.protected && <Lock size={9} />}
              {s.manifestType || s.kind || 'media'}
            </Badge>
            {s.qualities && s.qualities.length > 0 && (
              <span className="font-mono text-[10px] text-[var(--color-text-dim)]">{s.qualities.length} variants</span>
            )}
          </div>
          <p className="text-[13px] text-[var(--color-text)] truncate">{s.label || 'Detected media'}</p>
          <div className="flex items-center gap-1 text-[11px] text-[var(--color-text-dim)] truncate">
            <span className="truncate">{hostFromUrl(s.pageUrl) || hostFromUrl(s.url) || '—'}</span>
          </div>

          <div className="flex items-center gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="primary" iconLeft={<Download size={13} />} loading={busy} disabled={s.protected} onClick={() => onDownload(s)}>
              Download
            </Button>
            {!compact && onReview && s.manifestType && (
              <Button size="sm" variant="ghost" iconLeft={<ScanLine size={13} />} onClick={() => onReview(s)}>Review</Button>
            )}
            <IconButton size="sm" icon={<Copy size={14} />} label="Copy URL" onClick={() => onCopyUrl(s)} />
            <IconButton size="sm" icon={<ExternalLink size={14} />} label="Open page" onClick={() => onOpenPage(s)} />
          </div>
        </div>
      </div>
    </div>
  );
}
