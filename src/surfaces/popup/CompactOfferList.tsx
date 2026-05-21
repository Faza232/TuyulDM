import { StrategyChip } from '../dashboard/components/StrategyChip';
import { ExternalLink, Copy } from '../../ui/icons';
import { Button, IconButton, Chip } from '../../ui/primitives';
import type { DetectedStreamItem } from '../../state/types';

interface CompactOfferListProps {
  offers: DetectedStreamItem[];
  onDownload: (offer: DetectedStreamItem) => void;
}

export function CompactOfferList({ offers, onDownload }: CompactOfferListProps) {
  if (offers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center text-[var(--color-text-muted)] text-[12px]">
        No media detected yet. Scan the tab to find extractable media.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      {offers.map((offer) => {
        const isProtected = offer.protected;

        return (
          <div key={offer.id} className="flex flex-col p-2 bg-[var(--color-surface-raised)] border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)]">
            <div className="flex items-center gap-2 mb-2">
               <StrategyChip strategy={offer.manifestType || offer.source} className="text-[10px]" />
               <span className="truncate flex-1 text-[12px] font-medium text-[var(--color-text)]">
                 {offer.label || offer.url || 'Unknown stream'}
               </span>
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                 {isProtected && <Chip tone="warning" className="text-[10px] py-0 px-1">DRM</Chip>}
                 {offer.qualities && offer.qualities.length > 0 && !isProtected && (
                   <select className="bg-[var(--color-bg)] border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)] text-[11px] px-1.5 py-0.5 text-[var(--color-text-dim)] outline-none focus:border-[var(--color-accent)] max-w-[120px]">
                     {offer.qualities.map(q => (
                       <option key={q.id} value={q.id}>{q.resolution || q.name || q.id}</option>
                     ))}
                   </select>
                 )}
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="primary" disabled={isProtected} onClick={() => onDownload(offer)}>
                  Download
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
