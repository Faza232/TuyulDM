import { StrategyChip } from './StrategyChip';
import { ExternalLink, Copy } from '../../../ui/icons';
import { PosterPreview } from './PosterPreview';
import { Button, IconButton, Chip } from '../../../ui/primitives';
import type { DetectedStreamItem } from '../../../state/types';
import { cn } from '../../../ui/cn';

interface DetectedOfferCardProps {
  offer: DetectedStreamItem;
  selected?: boolean;
  onClick: () => void;
  onDownload: () => void;
}

export function DetectedOfferCard({ offer, selected, onClick, onDownload }: DetectedOfferCardProps) {
  const isProtected = offer.protected;

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "flex flex-col gap-3 p-3 text-left rounded-[var(--radius-sm)] border border-transparent transition-colors",
        "focus:outline-none focus-visible:border-[var(--color-accent)] cursor-pointer group",
        selected ? "bg-white/5 border-[var(--color-border)]" : "hover:bg-white/5 hover:border-[var(--color-border-subtle)]"
      )}
      onClick={onClick}
    >
      <div className="flex gap-3">
        <PosterPreview src={offer.posterUrl} className="w-[100px] h-[56px] shrink-0" />
        <div className="flex flex-col flex-1 min-w-0 justify-center">
          <div className="text-[13px] font-medium leading-tight truncate text-[var(--color-text)]">
            {offer.label || offer.url || 'Unknown stream'}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-[var(--color-text-dim)]">
             <StrategyChip strategy={offer.manifestType || offer.source} />
             <span className="truncate flex-1">
               {new URL(offer.pageUrl || 'http://localhost').hostname}
             </span>
          </div>
        </div>
      </div>
      
      <div className="flex items-center justify-between mt-1">
        <div className="flex items-center gap-2">
           {isProtected && <Chip tone="warning" className="text-[10px]">DRM</Chip>}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <IconButton size="sm" label="Copy URL" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(offer.url); }}>
            <Copy className="size-3.5" />
          </IconButton>
          <IconButton size="sm" label="Open page" onClick={(e) => { e.stopPropagation(); window.open(offer.pageUrl, '_blank'); }}>
            <ExternalLink className="size-3.5" />
          </IconButton>
          <Button size="sm" variant="primary" disabled={isProtected} onClick={(e) => { e.stopPropagation(); onDownload(); }}>
            Download
          </Button>
        </div>
      </div>
    </div>
  );
}
