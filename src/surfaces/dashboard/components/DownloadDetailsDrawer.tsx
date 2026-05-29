import { useEffect, useState } from 'react';
import { Drawer, Button, Badge, Chip } from '../../../ui/primitives';
import { FolderOpen, FileIcon, ExternalLink, Pause, Play, Trash2, Copy, RefreshCw, Clock } from '../../../ui/icons';
import { StrategyChip } from './StrategyChip';
import { AssemblyStageBadge } from './AssemblyStageBadge';
import type { DownloadItem } from '../../../state/types';
import {
  formatSize, formatAttemptTimestamp, getDownloadLabel, buildSafeDebugSnapshot, downloadNeedsUrlRefresh,
} from '../../../ui/format';

export type DownloadDetailsDrawerProps = {
  download: DownloadItem | null;
  open: boolean;
  onClose: () => void;
  onTogglePlayPause: (d: DownloadItem) => void;
  onCancel: (d: DownloadItem) => void;
  onOpenFile: (d: DownloadItem) => void;
  onReveal: (d: DownloadItem) => void;
  onOpenSource: (d: DownloadItem) => void;
  onRefreshFromTab: (d: DownloadItem) => void;
  onCopyDebug: (text: string) => void;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
      <h3 className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-text-dim)] mb-2">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-[12px] text-[var(--color-text-muted)] shrink-0">{label}</span>
      <span className="text-[12px] text-[var(--color-text)] font-mono text-right truncate">{value ?? '—'}</span>
    </div>
  );
}

function useCountdown(expiresAt?: string): string | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const t = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return 'expired';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m ${sec}s`;
}

export function DownloadDetailsDrawer(props: DownloadDetailsDrawerProps) {
  const { download: d, open, onClose } = props;
  const expiresAt = d?.offer_debug?.expires_at;
  const countdown = useCountdown(expiresAt);

  if (!d) return <Drawer open={open} onClose={onClose} title="Details" />;

  const isProtected = d.extraction_strategy === 'unsupported_protected';
  const isActive = d.status === 'downloading' || d.status === 'queued' || d.status === 'muxing';
  const needsRefresh = downloadNeedsUrlRefresh(d);

  return (
    <Drawer open={open} onClose={onClose} title={getDownloadLabel(d)}>
      <Section title="Status">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <StrategyChip strategy={d.extraction_strategy} />
          <Badge tone={d.status === 'finished' ? 'success' : d.status === 'error' ? 'danger' : 'neutral'}>{d.status}</Badge>
          <AssemblyStageBadge stage={d.assembly_stage} />
        </div>
        <Field label="Output path" value={d.output_path || '—'} />
        {d.output_path && (
          <div className="mt-1">
            <Button size="sm" variant="ghost" iconLeft={<FolderOpen size={14} />} onClick={() => props.onReveal(d)}>Open folder</Button>
          </div>
        )}
      </Section>

      <Section title="Strategy">
        <Field label="Extraction" value={d.extraction_strategy || '—'} />
        <Field label="Site key" value={d.site_key || '—'} />
        <Field label="Tracks" value={d.track_count ?? '—'} />
        <Field label="Final container" value={d.plan?.final_container || d.plan?.strategy || '—'} />
        <Field label="Plan steps" value={d.plan?.steps?.length ?? '—'} />
      </Section>

      {d.tracks && d.tracks.length > 0 && (
        <Section title="Tracks">
          <div className="space-y-1.5">
            {d.tracks.map((t, i) => (
              <div key={t.id || i} className="flex items-center gap-2 text-[12px]">
                <Chip tone="neutral">{t.kind || 'track'}</Chip>
                <span className="font-mono text-[var(--color-text-muted)] truncate">
                  {[t.codec, t.width && t.height ? `${t.width}×${t.height}` : '', t.bitrate ? `${Math.round(t.bitrate / 1000)} kbps` : '', t.container].filter(Boolean).join(' · ') || '—'}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Assembly">
        <Field label="Stage" value={d.assembly_stage || 'idle'} />
        <Field label="Last attempt" value={formatAttemptTimestamp(d.last_attempt_at)} />
        <Field label="Last error" value={d.error || d.error_code || '—'} />
      </Section>

      {(expiresAt || needsRefresh) && (
        <Section title="Expiry">
          <div className="flex items-center gap-2 mb-2 text-[12px] text-[var(--color-text-muted)]">
            <Clock size={13} />
            <span>{countdown ? `Expires in ${countdown}` : 'Link may be expired'}</span>
          </div>
          <Button size="sm" variant="secondary" iconLeft={<RefreshCw size={14} />} onClick={() => props.onRefreshFromTab(d)}>
            Refresh from current tab
          </Button>
        </Section>
      )}

      <Section title="Debug">
        <Button
          size="sm"
          variant="ghost"
          iconLeft={<Copy size={14} />}
          onClick={() => props.onCopyDebug(JSON.stringify(buildSafeDebugSnapshot(d), null, 2))}
        >
          Copy safe JSON
        </Button>
        <p className="mt-1 text-[11px] text-[var(--color-text-dim)]">Headers and cookies are stripped.</p>
      </Section>

      {!isProtected && (
        <Section title="Actions">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" iconLeft={isActive ? <Pause size={14} /> : <Play size={14} />} onClick={() => props.onTogglePlayPause(d)}>
              {isActive ? 'Pause' : 'Resume'}
            </Button>
            <Button size="sm" variant="secondary" iconLeft={<FileIcon size={14} />} disabled={d.status !== 'finished'} onClick={() => props.onOpenFile(d)}>Open file</Button>
            <Button size="sm" variant="secondary" iconLeft={<ExternalLink size={14} />} disabled={!d.url} onClick={() => props.onOpenSource(d)}>Source page</Button>
            <Button size="sm" variant="danger" iconLeft={<Trash2 size={14} />} onClick={() => props.onCancel(d)}>Cancel</Button>
          </div>
        </Section>
      )}
    </Drawer>
  );
}
