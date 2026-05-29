import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Button, EmptyState, ProgressBar, Select, Checkbox, Badge } from '../../../ui/primitives';
import { ScanLine, ExternalLink, Lock, Download, Copy } from '../../../ui/icons';
import { DetectedOfferCard } from '../components/DetectedOfferCard';
import { VariantPicker } from '../components/VariantPicker';
import { PosterPreview } from '../components/PosterPreview';
import { useDetection } from '../../../state/store';
import { useToasts } from '../../../state/toast';
import type { DetectedStreamItem } from '../../../state/types';
import { hostFromUrl } from '../../../ui/format';
import { motionSec } from '../../../ui/tokens';

export function Grabber() {
  const { detectedStreams, grabberNotice, isScanningPage, scanPage, startDetectedMediaDownload, reviewDetectedStream } = useDetection();
  const { push } = useToasts();
  const [focusId, setFocusId] = useState<string | null>(null);
  const [strategyFilter, setStrategyFilter] = useState('');
  const [showProtected, setShowProtected] = useState(true);
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => detectedStreams.filter((s) => {
    if (!showProtected && s.protected) return false;
    if (strategyFilter && (s.manifestType || s.kind) !== strategyFilter) return false;
    return true;
  }), [detectedStreams, strategyFilter, showProtected]);

  const focused = filtered.find((s) => s.id === focusId) || filtered[0] || null;

  const variantFor = (s: DetectedStreamItem) =>
    selectedVariants[s.id] || s.selectedVariantId || s.qualities?.[0]?.id || '';

  const copyUrl = async (s: DetectedStreamItem) => {
    try { await navigator.clipboard.writeText(s.url); push({ tone: 'success', title: 'URL copied' }); }
    catch { push({ tone: 'danger', title: 'Copy failed' }); }
  };
  const openPage = (s: DetectedStreamItem) => window.open(s.pageUrl || s.url, '_blank', 'noopener,noreferrer');

  const download = async (s: DetectedStreamItem) => {
    setBusyId(s.id);
    const r = await startDetectedMediaDownload(s.id, variantFor(s));
    setBusyId(null);
    if (r?.error) push({ tone: 'danger', title: 'Could not queue', body: r.error });
    else push({ tone: 'success', title: 'Queued', body: s.label });
  };

  const kinds = useMemo(() => Array.from(new Set(detectedStreams.map((s) => s.manifestType || s.kind).filter(Boolean))) as string[], [detectedStreams]);

  return (
    <div className="flex h-full">
      {/* feed */}
      <div className="w-1/2 border-r border-[var(--color-border-subtle)] flex flex-col">
        <div className="flex items-center gap-2 p-3 border-b border-[var(--color-border-subtle)] sticky top-0 bg-[var(--color-surface)] z-10">
          <Button size="sm" variant="primary" iconLeft={<ScanLine size={14} />} loading={isScanningPage} onClick={() => void scanPage()}>
            Scan current tab
          </Button>
          <Select
            className="w-32"
            value={strategyFilter}
            onChange={(e) => setStrategyFilter(e.target.value)}
            options={[{ value: '', label: 'All types' }, ...kinds.map((k) => ({ value: k, label: k }))]}
          />
          <Checkbox label="Protected" checked={showProtected} onChange={(e) => setShowProtected(e.target.checked)} />
        </div>
        {isScanningPage && <ProgressBar value={null} />}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {filtered.length === 0 ? (
            <EmptyState
              icon={<ScanLine size={28} />}
              title={grabberNotice || 'No media detected'}
              body="Scan the current tab to detect playable media."
              action={<Button size="sm" variant="primary" iconLeft={<ScanLine size={14} />} onClick={() => void scanPage()}>Scan current tab</Button>}
            />
          ) : (
            <AnimatePresence initial={false}>
              {filtered.map((s) => (
                <motion.div
                  key={s.id}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: motionSec.fast }}
                >
                  <DetectedOfferCard
                    stream={s}
                    selected={focused?.id === s.id}
                    busy={busyId === s.id}
                    onFocus={(x) => setFocusId(x.id)}
                    onReview={(x) => void reviewDetectedStream(x)}
                    onDownload={(x) => void download(x)}
                    onCopyUrl={(x) => void copyUrl(x)}
                    onOpenPage={openPage}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>

      {/* detail */}
      <div className="w-1/2 overflow-y-auto">
        {!focused ? (
          <div className="h-full flex items-center justify-center text-[13px] text-[var(--color-text-dim)]">Select a detected offer</div>
        ) : (
          <div className="p-4 space-y-4">
            <PosterPreview src={focused.posterUrl} className="w-full max-w-sm" />
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <Badge tone={focused.protected ? 'warning' : focused.manifestType ? 'accent' : 'neutral'}>
                  {focused.protected && <Lock size={9} />}{focused.manifestType || focused.kind || 'media'}
                </Badge>
              </div>
              <h2 className="text-[15px] font-medium text-[var(--color-text)]">{focused.label || 'Detected media'}</h2>
              <a href={focused.pageUrl || focused.url} target="_blank" rel="noopener noreferrer"
                 className="inline-flex items-center gap-1 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                {hostFromUrl(focused.pageUrl) || hostFromUrl(focused.url)} <ExternalLink size={12} />
              </a>
            </div>

            {focused.protected && (
              <div className="flex items-start gap-2 p-3 rounded-[var(--radius-md)] bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/20">
                <Lock size={14} className="text-[var(--color-warning)] mt-0.5" />
                <div>
                  <p className="text-[12px] text-[var(--color-text)]">{focused.protectedReason || 'This stream is protected and cannot be downloaded.'}</p>
                </div>
              </div>
            )}

            <div>
              <h3 className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-dim)] mb-2">Quality</h3>
              <VariantPicker
                variants={focused.qualities || []}
                selectedId={variantFor(focused)}
                onSelect={(id) => setSelectedVariants((p) => ({ ...p, [focused.id]: id }))}
                onConfirm={() => void download(focused)}
              />
            </div>

            <div className="flex items-center gap-2">
              <Button variant="primary" iconLeft={<Download size={14} />} loading={busyId === focused.id} disabled={focused.protected} onClick={() => void download(focused)}>
                Download
              </Button>
              <Button variant="secondary" iconLeft={<Copy size={14} />} onClick={() => void copyUrl(focused)}>Copy URL</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
