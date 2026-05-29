import { Select, Switch } from '../../../ui/primitives';
import { SectionHeader, SettingRow } from './_shared';
import { usePreferences } from '../../../state/preferences';

const ACCENTS = [
  { value: '#FAFAFA', label: 'White' },
  { value: '#34D399', label: 'Green' },
  { value: '#FBBF24', label: 'Amber' },
  { value: '#F87171', label: 'Red' },
  { value: '#60A5FA', label: 'Blue' },
];

export function General() {
  const { prefs, setPrefs } = usePreferences();
  return (
    <div>
      <SectionHeader eyebrow="Preferences" title="General" description="Appearance and behavior of the app." />
      <SettingRow
        label="Density"
        description="Row height across the queue and lists."
        control={
          <Select
            className="w-36"
            value={prefs.density}
            onChange={(e) => setPrefs({ density: e.target.value as 'cozy' | 'compact' })}
            options={[{ value: 'cozy', label: 'Cozy' }, { value: 'compact', label: 'Compact' }]}
          />
        }
      />
      <SettingRow
        label="Accent color"
        control={
          <Select
            className="w-36"
            value={prefs.accent}
            onChange={(e) => setPrefs({ accent: e.target.value })}
            options={ACCENTS}
          />
        }
      />
      <SettingRow
        label="Open file when finished"
        description="Automatically open downloads on completion."
        control={<Switch checked={prefs.openOnFinish} onChange={(v) => setPrefs({ openOnFinish: v })} />}
      />
    </div>
  );
}
