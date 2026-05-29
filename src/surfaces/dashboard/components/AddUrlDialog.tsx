import { useState } from 'react';
import { Dialog, Button, Input, Switch } from '../../../ui/primitives';
import { useDownloads } from '../../../state/store';
import { usePreferences } from '../../../state/preferences';
import { useToasts } from '../../../state/toast';
import { isValidDownloadUrl } from '../../../ui/format';
import { WEEKDAY_OPTIONS, normalizeScheduleHour } from '../../../state/normalize';
import { cn } from '../../../ui/cn';

export function AddUrlDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { startDownload } = useDownloads();
  const { prefs } = usePreferences();
  const { push } = useToasts();
  const [url, setUrl] = useState('');
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [startHour, setStartHour] = useState(2);
  const [endHour, setEndHour] = useState(6);
  const [days, setDays] = useState<number[]>(WEEKDAY_OPTIONS.map((d) => d.value));
  const [busy, setBusy] = useState(false);

  const trimmed = url.trim();
  const valid = isValidDownloadUrl(trimmed);

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    const schedule = scheduleEnabled
      ? { start_hour: normalizeScheduleHour(startHour), end_hour: normalizeScheduleHour(endHour), days: [...days] }
      : undefined;
    await startDownload(trimmed, prefs.segments, schedule);
    setBusy(false);
    push({ tone: 'success', title: 'Download queued' });
    setUrl('');
    setScheduleEnabled(false);
    onClose();
  };

  const toggleDay = (day: number) =>
    setDays((prev) => (prev.includes(day) ? (prev.length === 1 ? prev : prev.filter((d) => d !== day)) : [...prev, day].sort((a, b) => a - b)));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add download"
      description="Paste an http(s) URL to queue a download."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" loading={busy} disabled={!valid} onClick={() => void submit()}>Add</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          autoFocus
          placeholder="https://example.com/file.mp4"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          invalid={!!trimmed && !valid}
          onKeyDown={(e) => { if (e.key === 'Enter' && valid) void submit(); }}
        />
        <Switch checked={scheduleEnabled} onChange={setScheduleEnabled} label="Schedule download" />
        {scheduleEnabled && (
          <div className="space-y-2 pl-1">
            <div className="flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
              <span>From</span>
              <Input type="number" min={0} max={23} value={startHour} onChange={(e) => setStartHour(Number(e.target.value))} className="w-20" />
              <span>to</span>
              <Input type="number" min={0} max={23} value={endHour} onChange={(e) => setEndHour(Number(e.target.value))} className="w-20" />
            </div>
            <div className="flex flex-wrap gap-1">
              {WEEKDAY_OPTIONS.map((d) => (
                <button
                  key={d.value}
                  onClick={() => toggleDay(d.value)}
                  className={cn(
                    'px-2 h-7 rounded-[var(--radius-sm)] text-[11px] font-mono border',
                    days.includes(d.value)
                      ? 'bg-[var(--color-surface-raised)] border-[var(--color-border)] text-[var(--color-text)]'
                      : 'border-transparent text-[var(--color-text-dim)] hover:bg-white/5',
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
