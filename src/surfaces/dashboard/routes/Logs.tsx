import { useEffect, useState } from 'react';
import { bridge } from '../../../state';
import { Button, useToast } from '../../../ui/primitives';
import { ExternalLink, RefreshCw } from '../../../ui/icons';
import type { HostStats, HostStatus } from '../../../state/types';

export default function LogsRoute() {
  const { push } = useToast();
  const [status, setStatus] = useState<HostStatus | undefined>();
  const [stats, setStats] = useState<HostStats | undefined>();
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const [s, st] = await Promise.all([bridge.getHostStatus(), bridge.getHostStats()]);
      setStatus(s);
      setStats(st.stats);
    } catch (e) {
      push({ tone: 'danger', title: 'Failed to load host status', body: String((e as Error)?.message ?? e) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const open = async () => {
    try {
      await bridge.openLogs();
    } catch (e) {
      push({ tone: 'danger', title: 'Could not open logs', body: String((e as Error)?.message ?? e) });
    }
  };

  return (
    <div className="p-4 h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold tracking-tight">System</h2>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={refresh} disabled={loading}>
              <RefreshCw className={`size-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button size="sm" variant="secondary" onClick={open}>
              <ExternalLink className="size-3.5 mr-1.5" />
              Open log folder
            </Button>
          </div>
        </div>

        <section className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
          <header className="px-3 py-2 border-b border-[var(--color-border-subtle)] text-[12px] text-[var(--color-text-muted)]">
            Native host
          </header>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 p-3 text-[12px] font-mono">
            <dt className="text-[var(--color-text-dim)]">Connected</dt>
            <dd className={status?.connected ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}>
              {status ? (status.connected ? 'yes' : 'no') : '—'}
            </dd>
            <dt className="text-[var(--color-text-dim)]">Protocol</dt>
            <dd>{status?.protocolVersion || '—'}</dd>
            <dt className="text-[var(--color-text-dim)]">Last error</dt>
            <dd className="truncate">{status?.lastError || '—'}</dd>
          </dl>
        </section>

        <section className="rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] bg-[var(--color-surface)]">
          <header className="px-3 py-2 border-b border-[var(--color-border-subtle)] text-[12px] text-[var(--color-text-muted)]">
            Stats
          </header>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 p-3 text-[12px] font-mono">
            <dt className="text-[var(--color-text-dim)]">Active downloads</dt>
            <dd>{stats?.activeDownloads ?? '—'}</dd>
            <dt className="text-[var(--color-text-dim)]">Global speed</dt>
            <dd>{stats ? `${(stats.globalSpeedBytesPerSecond / (1024 * 1024)).toFixed(2)} MB/s` : '—'}</dd>
            <dt className="text-[var(--color-text-dim)]">Free disk</dt>
            <dd>{stats ? `${(stats.freeSpaceBytes / (1024 ** 3)).toFixed(1)} GB` : '—'}</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}
