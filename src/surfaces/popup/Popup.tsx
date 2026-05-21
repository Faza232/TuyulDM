import { useEffect, useState } from 'react';
import { useDetection, useDownloads } from '../../state';
import { CurrentTabHeader } from './CurrentTabHeader';
import { CompactOfferList } from './CompactOfferList';
import { PermissionBanner } from './PermissionBanner';
import { Button } from '../../ui/primitives';
import { ExternalLink, RefreshCw } from '../../ui/icons';
import type { DetectedStreamItem } from '../../state/types';

export default function Popup() {
  const { streams, isScanning, scan } = useDetection();
  const { addDownload } = useDownloads();

  const handleDownload = async (offer: DetectedStreamItem) => {
    await addDownload(offer.url, offer.label || 'Unknown', undefined, offer);
    window.close(); // Close the popup
  };

  const openDashboard = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: 'index.html' });
    } else {
      window.open('index.html', '_blank');
    }
  };

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg)] text-[var(--color-text)]">
      <CurrentTabHeader />
      <PermissionBanner />
      
      <div className="flex items-center justify-between p-2 pb-1">
        <Button size="sm" variant="ghost" onClick={scan} disabled={isScanning}>
           <RefreshCw className={`size-3.5 mr-1.5 ${isScanning ? 'animate-spin' : ''}`} />
           {isScanning ? 'Scanning...' : 'Scan tab'}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <CompactOfferList offers={streams} onDownload={handleDownload} />
      </div>

      <div className="p-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
        <Button size="sm" variant="ghost" className="w-full text-[var(--color-text-dim)] hover:text-[var(--color-text)]" onClick={openDashboard}>
           Open dashboard <ExternalLink className="size-3 ml-1" />
        </Button>
      </div>
    </div>
  );
}
