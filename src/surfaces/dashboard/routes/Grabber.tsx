import { useState, useMemo } from 'react';
import { useDetection, useDownloads } from '../../../state';
import { EmptyState, Button, Chip } from '../../../ui/primitives';
import { Video, ExternalLink } from '../../../ui/icons';
import { DetectedOfferCard } from '../components/DetectedOfferCard';
import { VariantPicker } from '../components/VariantPicker';
import { PosterPreview } from '../components/PosterPreview';
import { StrategyChip } from '../components/StrategyChip';
import type { DetectedStreamItem } from '../../../state/types';

export default function GrabberRoute() {
  const { streams, isScanning, scan } = useDetection();
  const { addDownload } = useDownloads(); // We need addDownload in useDownloads? Or from bridge?
  const [selectedId, setSelectedId] = useState<string | null>(null);
  
  const [filterStrategy, setFilterStrategy] = useState<string>('all');
  const [showProtected, setShowProtected] = useState(true);

  const filteredStreams = useMemo(() => {
    return streams.filter(s => {
      if (!showProtected && s.protected) return false;
      if (filterStrategy !== 'all' && s.manifestType !== filterStrategy && s.source !== filterStrategy) return false;
      return true;
    });
  }, [streams, filterStrategy, showProtected]);

  const selectedOffer = useMemo(() => {
    return streams.find(s => s.id === selectedId) || (filteredStreams.length > 0 ? filteredStreams[0] : null);
  }, [streams, selectedId, filteredStreams]);

  // Make sure we select the first one if selected is gone
  if (selectedOffer && !selectedId) {
    setSelectedId(selectedOffer.id);
  }

  const handleDownload = (offer: DetectedStreamItem, variantId?: string) => {
    addDownload(offer.url, offer.label || 'Unknown', undefined, offer);
  };

  if (streams.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-4 px-4 py-3 border-b border-[var(--color-border-subtle)]">
          <Button variant="primary" onClick={scan} disabled={isScanning}>
            {isScanning ? 'Scanning tab...' : 'Scan current tab'}
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <EmptyState
            icon={<Video className="size-8" />}
            title="No media detected"
            body="Scan the current tab to find media on the page."
            action={<Button onClick={scan} disabled={isScanning}>Scan again</Button>}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex divide-x divide-[var(--color-border-subtle)]">
      {/* Left Pane: Feed */}
      <div className="w-[340px] flex flex-col bg-[var(--color-surface)]">
        <div className="flex flex-col gap-2 px-3 py-2 border-b border-[var(--color-border-subtle)]">
           <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[var(--color-text-dim)] uppercase tracking-wider">Detection Feed</span>
              <Button size="sm" variant="ghost" onClick={scan} disabled={isScanning}>
                {isScanning ? 'Scanning...' : 'Rescan'}
              </Button>
           </div>
           
           <div className="flex items-center gap-2">
             <select 
                className="bg-white/5 border border-[var(--color-border-subtle)] rounded text-[11px] px-1.5 py-1 text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                value={filterStrategy} 
                onChange={e => setFilterStrategy(e.target.value)}
             >
               <option value="all">All strategies</option>
               <option value="hls_manifest">HLS</option>
               <option value="dash_manifest">DASH</option>
               <option value="direct_file">Direct File</option>
             </select>
             
             <label className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-dim)] cursor-pointer">
               <input type="checkbox" checked={showProtected} onChange={e => setShowProtected(e.target.checked)} className="accent-[var(--color-accent)]" />
               Show Protected
             </label>
           </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
          {filteredStreams.map(offer => (
            <DetectedOfferCard
              key={offer.id}
              offer={offer}
              selected={offer.id === selectedId}
              onClick={() => setSelectedId(offer.id)}
              onDownload={() => handleDownload(offer)}
            />
          ))}
          {filteredStreams.length === 0 && (
            <div className="text-[12px] text-center text-[var(--color-text-muted)] py-8">No streams match filters</div>
          )}
        </div>
      </div>
      
      {/* Right Pane: Detail */}
      <div className="flex-1 flex flex-col overflow-y-auto bg-[var(--color-bg)]">
        {selectedOffer ? (
          <div className="max-w-3xl w-full mx-auto p-6 md:p-8 flex flex-col gap-8">
            {/* Header */}
            <div className="flex gap-6">
               <PosterPreview src={selectedOffer.posterUrl} className="w-[180px] h-[100px] shrink-0" />
               <div className="flex flex-col min-w-0 justify-center">
                 <h2 className="text-lg font-medium text-[var(--color-text)] mb-2 truncate">{selectedOffer.label || selectedOffer.url || 'Unknown stream'}</h2>
                 
                 <div className="flex flex-wrap items-center gap-2 mb-3">
                   <StrategyChip strategy={selectedOffer.manifestType || selectedOffer.source} />
                   {selectedOffer.protected && <Chip tone="warning">Protected (DRM)</Chip>}
                 </div>
                 
                 <a href={selectedOffer.pageUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors w-fit">
                    <ExternalLink className="size-3.5" />
                    <span className="truncate">{selectedOffer.pageUrl}</span>
                 </a>
               </div>
            </div>
            
            {/* Action/Refusal Banner */}
            {selectedOffer.protected && (
              <div className="p-3 bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 rounded-[var(--radius-sm)] flex flex-col gap-1">
                 <span className="text-[13px] font-medium text-[var(--color-danger)]">Protected stream detected</span>
                 <span className="text-[12px] text-[var(--color-danger)]/80">This media uses DRM encryption. TuyulDM cannot download encrypted media.</span>
              </div>
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Variants */}
              <div className="flex flex-col gap-3">
                 <h3 className="text-[11px] font-medium text-[var(--color-text-dim)] uppercase tracking-wider">Quality Variants</h3>
                 <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-md)] p-1 overflow-hidden">
                    <VariantPicker
                      variants={selectedOffer.qualities || []}
                      selectedId={selectedOffer.selectedVariantId}
                      onSelect={(id) => console.log('Selected variant', id)}
                      onDownload={(id) => handleDownload(selectedOffer, id)}
                    />
                 </div>
              </div>
              
              {/* Debug / Info */}
              <div className="flex flex-col gap-3">
                 <h3 className="text-[11px] font-medium text-[var(--color-text-dim)] uppercase tracking-wider">Offer Debug</h3>
                 <pre className="text-[10px] font-mono p-3 bg-[var(--color-surface)] border border-[var(--color-border-subtle)] rounded-[var(--radius-sm)] overflow-x-auto text-[var(--color-text-muted)]">
                   {JSON.stringify(selectedOffer, null, 2)}
                 </pre>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <span className="text-[var(--color-text-dim)]">Select an offer</span>
          </div>
        )}
      </div>
    </div>
  );
}
