import { useEffect, useState } from 'react';
import { Globe } from '../../ui/icons';
import { bridge } from '../../state/bridge';
import { hostFromUrl } from '../../ui/format';

export function CurrentTabHeader() {
  const [tab, setTab] = useState<{ url?: string; title?: string; favIconUrl?: string } | null>(null);

  useEffect(() => {
    void bridge.getActiveTab().then((t) => setTab(t || null));
  }, []);

  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-[var(--color-border-subtle)]">
      {tab?.favIconUrl ? (
        <img src={tab.favIconUrl} alt="" className="w-4 h-4 rounded-sm shrink-0" />
      ) : (
        <Globe size={16} className="text-[var(--color-text-dim)] shrink-0" />
      )}
      <div className="min-w-0">
        <p className="text-[12px] text-[var(--color-text)] truncate">{tab?.title || 'Current tab'}</p>
        <p className="text-[10px] font-mono text-[var(--color-text-dim)] truncate">{hostFromUrl(tab?.url) || ''}</p>
      </div>
    </div>
  );
}
