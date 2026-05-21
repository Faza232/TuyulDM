import { useSettings } from '../../../state/settings';
import { Input } from '../../../ui/primitives';

export function StorageSection({ searchQuery }: { searchQuery: string }) {
  const { hostSettings, updateHostSettings } = useSettings();

  if (searchQuery && !'storage directory folder path'.includes(searchQuery.toLowerCase())) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-[16px] font-semibold text-[var(--color-text)] mb-1">Storage</h2>
        <p className="text-[13px] text-[var(--color-text-muted)] mb-6">Manage download locations and storage space.</p>
        
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-[13px] font-medium text-[var(--color-text)]">Download Directory</label>
            <Input 
              placeholder="/home/user/Downloads or C:\Downloads"
              value={hostSettings?.downloadDir || ''}
              onChange={(e) => updateHostSettings({ downloadDir: e.target.value })}
            />
            <p className="text-[12px] text-[var(--color-text-muted)]">Absolute path where downloaded files will be saved by the native host.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
