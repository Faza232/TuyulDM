import { useEffect, useState } from 'react';
import { ExternalLink } from '../../ui/icons';

interface TabInfo {
  title?: string;
  url?: string;
  favIconUrl?: string;
}

export function CurrentTabHeader() {
  const [tab, setTab] = useState<TabInfo | null>(null);

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs.length > 0) {
          setTab({
            title: tabs[0].title,
            url: tabs[0].url,
            favIconUrl: tabs[0].favIconUrl
          });
        }
      });
    } else {
      // Mock for web dev env
      setTab({
        title: 'Local Development Tab',
        url: 'http://localhost:5173',
        favIconUrl: 'https://vitejs.dev/logo.svg'
      });
    }
  }, []);

  if (!tab) return null;

  return (
    <div className="flex items-center gap-3 p-3 bg-[var(--color-surface)] border-b border-[var(--color-border-subtle)]">
      {tab.favIconUrl ? (
        <img src={tab.favIconUrl} className="size-5 shrink-0 rounded-sm bg-white/10" alt="Site icon" />
      ) : (
        <div className="size-5 shrink-0 rounded-sm bg-[var(--color-surface-raised)] border border-[var(--color-border-subtle)]" />
      )}
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-[13px] font-medium text-[var(--color-text)] truncate">{tab.title || 'Unknown page'}</span>
        <span className="text-[11px] text-[var(--color-text-dim)] truncate mt-0.5">{tab.url ? new URL(tab.url).hostname : ''}</span>
      </div>
    </div>
  );
}
