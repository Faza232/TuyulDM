import { Button, EmptyState, Badge } from '../../../ui/primitives';
import { ExternalLink, Activity } from '../../../ui/icons';
import { useSystem } from '../../../state/store';

export function Logs() {
  const { hostStatus, hostStats, openLogs, isExtension } = useSystem();

  return (
    <div className="p-4 space-y-4 max-w-xl">
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border-subtle)] p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-[var(--color-text)]">Native host</span>
          <Badge tone={hostStatus.connected ? 'success' : 'danger'}>{hostStatus.connected ? 'connected' : 'offline'}</Badge>
        </div>
        <div className="flex items-baseline justify-between text-[12px]">
          <span className="text-[var(--color-text-muted)]">Protocol</span>
          <span className="font-mono text-[var(--color-text)]">{hostStatus.protocolVersion}</span>
        </div>
        <div className="flex items-baseline justify-between text-[12px]">
          <span className="text-[var(--color-text-muted)]">Active downloads</span>
          <span className="font-mono text-[var(--color-text)]">{hostStats.activeDownloads}</span>
        </div>
        {hostStatus.lastError && (
          <p className="text-[12px] text-[var(--color-danger)] font-mono break-all">{hostStatus.lastError}</p>
        )}
      </div>

      {isExtension ? (
        <Button variant="secondary" iconLeft={<ExternalLink size={14} />} onClick={() => void openLogs()}>
          Open host log file
        </Button>
      ) : (
        <EmptyState icon={<Activity size={28} />} title="Logs need the extension" body="Host logs are available when running inside the browser extension." />
      )}
    </div>
  );
}
