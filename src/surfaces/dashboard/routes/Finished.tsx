import { useState, useMemo } from 'react';
import { useDownloads, useUISettings, bridge } from '../../../state';
import { EmptyState, Input, useToast } from '../../../ui/primitives';
import { CheckCircle2, Search } from '../../../ui/icons';
import { DownloadRow } from '../components/DownloadRow';
import type { DownloadItem } from '../../../state/types';

export default function FinishedRoute() {
  const { downloads } = useDownloads();
  const { uiSettings } = useUISettings();
  const { push } = useToast();
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [query, setQuery] = useState('');

  const finished = useMemo(
    () => downloads.filter(d => d.status === 'finished'),
    [downloads],
  );

  const visible = useMemo(() => {
    if (!query.trim()) return finished;
    const q = query.toLowerCase();
    return finished.filter(d =>
      (d.filename || d.name || d.offer_title || '').toLowerCase().includes(q) ||
      (d.url || '').toLowerCase().includes(q),
    );
  }, [finished, query]);

  const openFile = async (id: string | number) => {
    try {
      await bridge.openDownloadFile(id);
    } catch (e) {
      push({ tone: 'danger', title: 'Could not open file', body: String((e as Error)?.message ?? e) });
    }
  };

  const handleSelect = (id: string | number) => {
    if (selectedId === id) {
      openFile(id);
    } else {
      setSelectedId(id);
    }
  };

  if (finished.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <EmptyState
          icon={<CheckCircle2 className="size-8" />}
          title="No finished downloads"
          body="Completed downloads will land here."
        />
      </div>
    );
  }

  return (
    <div className="p-4 h-full overflow-y-auto">
      <div className="flex flex-col gap-3 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-[var(--color-text-muted)]">
            {visible.length} finished
          </h2>
          <Input
            iconLeft={<Search />}
            placeholder="Filter…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-64"
          />
        </div>
        <div className="flex flex-col gap-1">
          {visible.map(d => (
            <DownloadRow
              key={d.id}
              download={d as DownloadItem}
              density={uiSettings.density}
              selected={selectedId === d.id}
              onClick={() => handleSelect(d.id)}
              onContextMenu={(e) => { e.preventDefault(); setSelectedId(d.id); }}
              onAction={() => undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
