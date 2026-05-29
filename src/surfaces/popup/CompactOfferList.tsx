import { useState } from 'react';
import { Select, Button, Badge } from '../../ui/primitives';
import { Download, ExternalLink, Lock } from '../../ui/icons';
import type { DetectedStreamItem } from '../../state/types';

export type CompactOfferListProps = {
  streams: DetectedStreamItem[];
  onDownload: (s: DetectedStreamItem, variantId: string) => void;
  busyId: string | null;
};

function OfferRow({ stream, onDownload, busy }: { stream: DetectedStreamItem; onDownload: (s: DetectedStreamItem, v: string) => void; busy: boolean }) {
  const [variant, setVariant] = useState(stream.selectedVariantId || stream.qualities?.[0]?.id || '');
  const hasVariants = (stream.qualities?.length || 0) > 1;

  return (
    <div className="p-2.5 border-b border-[var(--color-border-subtle)]">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Badge tone={stream.protected ? 'warning' : stream.manifestType ? 'accent' : 'neutral'}>
          {stream.protected && <Lock size={9} />}{stream.manifestType || stream.kind || 'media'}
        </Badge>
        <span className="text-[12px] text-[var(--color-text)] truncate">{stream.label || 'Detected media'}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {hasVariants && (
          <Select
            className="flex-1"
            value={variant}
            onChange={(e) => setVariant(e.target.value)}
            options={(stream.qualities || []).map((q) => ({ value: q.id, label: q.resolution || q.name || q.id }))}
          />
        )}
        <Button size="sm" variant="primary" iconLeft={<Download size={13} />} loading={busy} disabled={stream.protected} onClick={() => onDownload(stream, variant)}>
          Download
        </Button>
        <a
          href={stream.pageUrl || stream.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center h-7 w-7 rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:bg-white/5"
          aria-label="Open page"
        >
          <ExternalLink size={14} />
        </a>
      </div>
    </div>
  );
}

export function CompactOfferList({ streams, onDownload, busyId }: CompactOfferListProps) {
  return (
    <div>
      {streams.map((s) => (
        <OfferRow key={s.id} stream={s} onDownload={onDownload} busy={busyId === s.id} />
      ))}
    </div>
  );
}
