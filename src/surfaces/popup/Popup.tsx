import { useEffect, useState } from 'react';
import { Button, EmptyState, IconButton } from '../../ui/primitives';
import { ScanLine, RefreshCw, ExternalLink } from '../../ui/icons';
import { CurrentTabHeader } from './CurrentTabHeader';
import { CompactOfferList } from './CompactOfferList';
import { ToastProvider } from '../../state/toast';
import { PreferencesProvider } from '../../state/preferences';
import { StateProvider, useDetection, useSystem } from '../../state/store';
import { bridge } from '../../state/bridge';
import type { DetectedStreamItem } from '../../state/types';

function PermissionBanner() {
  const { permission, requestCurrentTabPermission } = useSystem();
  if (permission.currentOriginGranted || !permission.canRequestCurrentOrigin) return null;
  return (
    <div className="p-2.5 border-b border-[var(--color-border-subtle)] bg-[var(--color-warning)]/5">
      <p className="text-[11px] text-[var(--color-text-muted)] mb-1.5">Grant access to detect media on this site.</p>
      <Button size="sm" variant="secondary" onClick={() => void requestCurrentTabPermission()}>Grant access</Button>
    </div>
  );
}

function PopupBody() {
  const { detectedStreams, grabberNotice, isScanningPage, scanPage, startDetectedMediaDownload, refreshDetectedStreams } = useDetection();
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => { void scanPage(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onDownload = async (s: DetectedStreamItem, variantId: string) => {
    setBusyId(s.id);
    const r = await startDetectedMediaDownload(s.id, variantId);
    setBusyId(null);
    if (!r?.error) {
      bridge.openDashboard(s.id);
      window.close();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <CurrentTabHeader />
      <PermissionBanner />
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border-subtle)]">
        <Button size="sm" variant="primary" iconLeft={<ScanLine size={13} />} loading={isScanningPage} onClick={() => void scanPage()}>Scan tab</Button>
        <IconButton size="sm" icon={<RefreshCw size={14} />} label="Refresh" onClick={() => void refreshDetectedStreams()} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {detectedStreams.length === 0 ? (
          <EmptyState
            icon={<ScanLine size={24} />}
            title={grabberNotice || 'No media detected'}
            body="Scan the current tab to find downloadable media."
          />
        ) : (
          <CompactOfferList streams={detectedStreams} onDownload={onDownload} busyId={busyId} />
        )}
      </div>

      <button
        onClick={() => { bridge.openDashboard(); window.close(); }}
        className="flex items-center justify-center gap-1.5 h-10 border-t border-[var(--color-border-subtle)] text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-white/5"
      >
        Open dashboard <ExternalLink size={13} />
      </button>
    </div>
  );
}

export function Popup() {
  return (
    <ToastProvider>
      <PreferencesProvider>
        <StateProvider>
          <PopupBody />
        </StateProvider>
      </PreferencesProvider>
    </ToastProvider>
  );
}
