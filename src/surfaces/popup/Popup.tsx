import { useEffect, useState } from 'react';
import { useDetection } from '../../state/detection';

export default function Popup() {
  const { streams, isScanning, scan } = useDetection();

  return (
    <div className="p-4 bg-[var(--color-bg)] text-[var(--color-text)] min-h-screen">
      <h1 className="text-xl font-bold mb-4">Popup</h1>
      <button onClick={scan} disabled={isScanning} className="mb-4">
        {isScanning ? 'Scanning...' : 'Scan Tab'}
      </button>
      <div>
        {streams.map((s, i) => (
          <div key={i} className="mb-2 p-2 bg-[var(--color-surface)] border border-[var(--color-border)]">
            {s.label || s.url || 'Unknown Stream'}
          </div>
        ))}
      </div>
    </div>
  );
}
