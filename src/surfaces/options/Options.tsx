import { useMemo, useRef, useState } from 'react';
import { Input } from '../../ui/primitives';
import { Search } from '../../ui/icons';
import { ToastProvider } from '../../state/toast';
import { PreferencesProvider } from '../../state/preferences';
import { StateProvider } from '../../state/store';
import { General } from './sections/General';
import { Detection } from './sections/Detection';
import { Network } from './sections/Network';
import { Adapters } from './sections/Adapters';
import { Storage } from './sections/Storage';
import { Logging } from './sections/Logging';
import { About } from './sections/About';
import { cn } from '../../ui/cn';

type SectionId = 'general' | 'detection' | 'network' | 'adapters' | 'storage' | 'logging' | 'about';

const SECTIONS: Array<{ id: SectionId; label: string; keywords: string; Component: () => React.ReactNode }> = [
  { id: 'general', label: 'General', keywords: 'density accent color theme open finish appearance', Component: General },
  { id: 'detection', label: 'Detection', keywords: 'intercept origins domains extensions scan permissions site access blob mse', Component: Detection },
  { id: 'network', label: 'Network', keywords: 'concurrent segments throttle bandwidth limit speed connections', Component: Network },
  { id: 'adapters', label: 'Adapters', keywords: 'resolver binary path timeout external debug', Component: Adapters },
  { id: 'storage', label: 'Storage', keywords: 'download folder directory disk space cleanup', Component: Storage },
  { id: 'logging', label: 'Logging', keywords: 'log verbosity redact cookies headers export level', Component: Logging },
  { id: 'about', label: 'About', keywords: 'version host status update channel links repository', Component: About },
];

function OptionsBody() {
  const [active, setActive] = useState<SectionId>('general');
  const [query, setQuery] = useState('');
  const mainRef = useRef<HTMLDivElement>(null);
  const scrollPos = useRef<Record<string, number>>({});

  const visibleSections = useMemo(() => {
    if (!query.trim()) return SECTIONS;
    const q = query.toLowerCase();
    return SECTIONS.filter((s) => s.label.toLowerCase().includes(q) || s.keywords.includes(q) || s.keywords.split(' ').some((k) => k.startsWith(q)));
  }, [query]);

  const current = (visibleSections.find((s) => s.id === active) || visibleSections[0] || SECTIONS[0]);

  const switchTo = (id: SectionId) => {
    if (mainRef.current) scrollPos.current[active] = mainRef.current.scrollTop;
    setActive(id);
    requestAnimationFrame(() => { if (mainRef.current) mainRef.current.scrollTop = scrollPos.current[id] || 0; });
  };

  const Current = current.Component;

  return (
    <div className="min-h-screen flex justify-center bg-[var(--color-bg)]">
      <div className="flex w-full max-w-4xl">
        <aside className="w-56 shrink-0 border-r border-[var(--color-border-subtle)] p-3 sticky top-0 h-screen">
          <div className="px-1 mb-3">
            <span className="font-mono text-[13px] text-[var(--color-text)]">TuyulDM</span>
            <p className="text-[11px] text-[var(--color-text-dim)]">Settings</p>
          </div>
          <Input iconLeft={<Search size={14} />} placeholder="Search settings…" value={query} onChange={(e) => setQuery(e.target.value)} className="mb-2" />
          <nav className="space-y-0.5">
            {visibleSections.map((s) => (
              <button
                key={s.id}
                onClick={() => switchTo(s.id)}
                className={cn(
                  'flex items-center w-full px-2.5 h-8 rounded-[var(--radius-sm)] text-[13px] text-left',
                  current.id === s.id ? 'bg-[var(--color-surface-raised)] text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:bg-white/5 hover:text-[var(--color-text)]',
                )}
              >
                {s.label}
              </button>
            ))}
          </nav>
        </aside>
        <main ref={mainRef} className="flex-1 h-screen overflow-y-auto px-8 py-8 max-w-2xl">
          <Current />
        </main>
      </div>
    </div>
  );
}

export function Options() {
  return (
    <ToastProvider>
      <PreferencesProvider>
        <StateProvider>
          <OptionsBody />
        </StateProvider>
      </PreferencesProvider>
    </ToastProvider>
  );
}
