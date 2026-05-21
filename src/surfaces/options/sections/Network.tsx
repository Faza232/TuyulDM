import { useSettings } from '../../../state/settings';
import { Input, Switch } from '../../../ui/primitives';

export function NetworkSection({ searchQuery }: { searchQuery: string }) {
  const { hostSettings, updateHostSettings, interceptionSettings, updateInterceptionSettings } = useSettings();

  if (searchQuery && !'network concurrency throttle bytes speed limit schedule'.includes(searchQuery.toLowerCase())) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-[16px] font-semibold text-[var(--color-text)] mb-1">Network & Limits</h2>
        <p className="text-[13px] text-[var(--color-text-muted)] mb-6">Manage download concurrency and speed throttling.</p>
        
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label className="text-[13px] font-medium text-[var(--color-text)]">Max Concurrent Downloads</label>
            <Input 
              type="number"
              min="1"
              max="20"
              value={hostSettings?.maxConcurrentDownloads || 3}
              onChange={(e) => updateHostSettings({ maxConcurrentDownloads: Math.max(1, Number(e.target.value)) })}
            />
            <p className="text-[12px] text-[var(--color-text-muted)]">Maximum number of files downloading simultaneously.</p>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[13px] font-medium text-[var(--color-text)]">Global Speed Limit (Bytes/s)</label>
            <Input 
              type="number"
              min="0"
              value={hostSettings?.globalThrottleBytesPerSecond || 0}
              onChange={(e) => updateHostSettings({ globalThrottleBytesPerSecond: Number(e.target.value) })}
            />
            <p className="text-[12px] text-[var(--color-text-muted)]">0 for unlimited globally.</p>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[13px] font-medium text-[var(--color-text)]">Per-Download Speed Limit (Bytes/s)</label>
            <Input 
              type="number"
              min="0"
              value={hostSettings?.perDownloadThrottleBytesPerSecond || 0}
              onChange={(e) => updateHostSettings({ perDownloadThrottleBytesPerSecond: Number(e.target.value) })}
            />
            <p className="text-[12px] text-[var(--color-text-muted)]">0 for unlimited per item.</p>
          </div>

          <div className="border-t border-[var(--color-border-subtle)] my-2" />

          <h3 className="text-[14px] font-medium text-[var(--color-text)]">Download Schedule</h3>
          <Switch 
            label="Enable Scheduling" 
            description="Only allow active downloads during specific hours."
            checked={interceptionSettings?.scheduleEnabled ?? false}
            onChange={(e) => updateInterceptionSettings({ scheduleEnabled: e.target.checked })}
          />
          
          {interceptionSettings?.scheduleEnabled && (
             <div className="flex gap-4">
                <div className="flex flex-col gap-2 flex-1">
                  <label className="text-[13px] font-medium text-[var(--color-text)]">Start Hour (0-23)</label>
                  <Input 
                    type="number" min="0" max="23"
                    value={interceptionSettings?.scheduleStartHour || 0}
                    onChange={(e) => updateInterceptionSettings({ scheduleStartHour: Number(e.target.value) })}
                  />
                </div>
                <div className="flex flex-col gap-2 flex-1">
                  <label className="text-[13px] font-medium text-[var(--color-text)]">End Hour (0-23)</label>
                  <Input 
                    type="number" min="0" max="23"
                    value={interceptionSettings?.scheduleEndHour || 23}
                    onChange={(e) => updateInterceptionSettings({ scheduleEndHour: Number(e.target.value) })}
                  />
                </div>
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
