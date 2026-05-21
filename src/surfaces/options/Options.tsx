import { useSettings } from '../../state/settings';

export default function Options() {
  const { hostSettings, interceptionSettings, updateHostSettings } = useSettings();

  return (
    <div className="p-8 bg-[var(--color-bg)] text-[var(--color-text)] min-h-screen">
      <h1 className="text-2xl font-bold mb-6">Options</h1>
      {hostSettings && (
        <label>
          Max Concurrent Downloads:
          <input 
            type="number" 
            value={hostSettings.maxConcurrentDownloads} 
            onChange={e => updateHostSettings({ maxConcurrentDownloads: Number(e.target.value) })}
            className="ml-2 px-2 py-1 text-black"
          />
        </label>
      )}
    </div>
  );
}
