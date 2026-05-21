import { useSettings } from '../../../state/settings';
import { Switch } from '../../../ui/primitives';

export function GeneralSection({ searchQuery }: { searchQuery: string }) {
  const { interceptionSettings, updateInterceptionSettings } = useSettings();

  if (searchQuery && !'general auto show'.includes(searchQuery.toLowerCase())) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-[16px] font-semibold text-[var(--color-text)] mb-1">General</h2>
        <p className="text-[13px] text-[var(--color-text-muted)] mb-6">General application preferences.</p>
        
        <div className="flex flex-col gap-4">
          <Switch 
            label="Auto-show video grabber" 
            description="Automatically pop up the video grabber when media is detected on the active page."
            checked={interceptionSettings?.autoShowDetectedStreams ?? true}
            onChange={(e) => updateInterceptionSettings({ autoShowDetectedStreams: e.target.checked })}
          />
        </div>
      </div>
    </div>
  );
}
