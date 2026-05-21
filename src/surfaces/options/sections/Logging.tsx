import { useSettings } from '../../../state/settings';
import { Select } from '../../../ui/primitives';

export function LoggingSection({ searchQuery }: { searchQuery: string }) {
  const { hostSettings, updateHostSettings } = useSettings();

  if (searchQuery && !'log logging debug error level'.includes(searchQuery.toLowerCase())) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-[16px] font-semibold text-[var(--color-text)] mb-1">Logging & Debugging</h2>
        <p className="text-[13px] text-[var(--color-text-muted)] mb-6">Configure the output verbosity for the native engine.</p>
        
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-[13px] font-medium text-[var(--color-text)]">Log Level</label>
            <div className="w-48">
              <Select 
                value={hostSettings?.logLevel || 'info'}
                onChange={(e) => updateHostSettings({ logLevel: e.target.value })}
                options={[
                  { value: 'debug', label: 'Debug' },
                  { value: 'info', label: 'Info' },
                  { value: 'warning', label: 'Warning' },
                  { value: 'error', label: 'Error' },
                ]}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
