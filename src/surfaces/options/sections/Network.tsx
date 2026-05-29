import { Input } from '../../../ui/primitives';
import { SectionHeader, SettingRow } from './_shared';
import { useSettings } from '../../../state/store';
import { usePreferences } from '../../../state/preferences';
import { useToasts } from '../../../state/toast';
import { kilobytesPerSecondFromBytes, bytesPerSecondFromKilobytes } from '../../../ui/format';

export function Network() {
  const { hostSettings, persistHostSettings } = useSettings();
  const { prefs, setPrefs } = usePreferences();
  const { push } = useToasts();

  const save = async (patch: Partial<typeof hostSettings>) => {
    const r = await persistHostSettings(patch);
    if (!r?.error) push({ tone: 'success', title: 'Saved' });
  };

  return (
    <div>
      <SectionHeader eyebrow="Transfer" title="Network" description="Concurrency and bandwidth limits." />
      <SettingRow
        label="Concurrent downloads"
        description="How many downloads run from the queue at once."
        control={<Input type="number" min={1} max={32} value={hostSettings.maxConcurrentDownloads} onChange={(e) => void save({ maxConcurrentDownloads: Number(e.target.value) })} className="w-24" />}
      />
      <SettingRow
        label="Segments per file"
        description="Parallel connections per download."
        control={<Input type="number" min={1} max={32} value={prefs.segments} onChange={(e) => setPrefs({ segments: Number(e.target.value) })} className="w-24" />}
      />
      <SettingRow
        label="Global limit (KB/s)"
        description="0 = unlimited."
        control={<Input type="number" min={0} value={kilobytesPerSecondFromBytes(hostSettings.globalThrottleBytesPerSecond)} onChange={(e) => void save({ globalThrottleBytesPerSecond: bytesPerSecondFromKilobytes(Number(e.target.value)) })} className="w-28" />}
      />
      <SettingRow
        label="Per-download limit (KB/s)"
        description="0 = unlimited."
        control={<Input type="number" min={0} value={kilobytesPerSecondFromBytes(hostSettings.perDownloadThrottleBytesPerSecond)} onChange={(e) => void save({ perDownloadThrottleBytesPerSecond: bytesPerSecondFromKilobytes(Number(e.target.value)) })} className="w-28" />}
      />
    </div>
  );
}
