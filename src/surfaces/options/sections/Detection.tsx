import { useSettings } from '../../../state/settings';
import { Switch, Input } from '../../../ui/primitives';

export function DetectionSection({ searchQuery }: { searchQuery: string }) {
  const { interceptionSettings, updateInterceptionSettings } = useSettings();

  if (searchQuery && !'detection intercept media extensions formats'.includes(searchQuery.toLowerCase())) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-[16px] font-semibold text-[var(--color-text)] mb-1">Detection & Interception</h2>
        <p className="text-[13px] text-[var(--color-text-muted)] mb-6">Configure how TuyulDM detects and captures media from web pages.</p>
        
        <div className="flex flex-col gap-6">
          <Switch 
            label="Enable Media Detection" 
            description="Actively monitor network requests and page content for downloadable media."
            checked={interceptionSettings?.enabled ?? true}
            onChange={(e) => updateInterceptionSettings({ enabled: e.target.checked })}
          />

          <div className="flex flex-col gap-2">
            <label className="text-[13px] font-medium text-[var(--color-text)]">File Extensions</label>
            <Input 
              placeholder="mp4, m3u8, mpd, mkv..." 
              value={interceptionSettings?.extensions.join(', ') || ''}
              onChange={(e) => updateInterceptionSettings({ extensions: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
            />
            <p className="text-[12px] text-[var(--color-text-muted)]">Comma-separated list of formats to monitor.</p>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[13px] font-medium text-[var(--color-text)]">Minimum File Size (MB)</label>
            <Input 
              type="number"
              min="0"
              value={interceptionSettings?.minFileSizeMB || 0}
              onChange={(e) => updateInterceptionSettings({ minFileSizeMB: Number(e.target.value) })}
            />
            <p className="text-[12px] text-[var(--color-text-muted)]">Ignore media files smaller than this size.</p>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[13px] font-medium text-[var(--color-text)]">Allowed Domains</label>
            <Input 
              placeholder="example.com, videos.org" 
              value={interceptionSettings?.allowDomains.join(', ') || ''}
              onChange={(e) => updateInterceptionSettings({ allowDomains: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[13px] font-medium text-[var(--color-text)]">Blocked Domains</label>
            <Input 
              placeholder="ads.example.com" 
              value={interceptionSettings?.blockDomains.join(', ') || ''}
              onChange={(e) => updateInterceptionSettings({ blockDomains: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
