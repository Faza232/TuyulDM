import { Select, Switch, Button } from '../../../ui/primitives';
import { ExternalLink } from '../../../ui/icons';
import { SectionHeader, SettingRow } from './_shared';
import { useSettings, useSystem } from '../../../state/store';
import { usePreferences } from '../../../state/preferences';
import { useToasts } from '../../../state/toast';

export function Logging() {
  const { hostSettings, persistHostSettings } = useSettings();
  const { openLogs, isExtension } = useSystem();
  const { adapter, setAdapter } = usePreferences();
  const { push } = useToasts();

  const save = async (level: string) => {
    const r = await persistHostSettings({ logLevel: level });
    if (!r?.error) push({ tone: 'success', title: 'Saved' });
  };

  return (
    <div>
      <SectionHeader eyebrow="Diagnostics" title="Logging" description="Verbosity and log export." />
      <SettingRow
        label="Log verbosity"
        control={
          <Select
            className="w-32"
            value={hostSettings.logLevel}
            onChange={(e) => void save(e.target.value)}
            options={[{ value: 'debug', label: 'Debug' }, { value: 'info', label: 'Info' }, { value: 'warn', label: 'Warn' }, { value: 'error', label: 'Error' }]}
          />
        }
      />
      <SettingRow
        label="Redact cookies & headers"
        description="Always strip sensitive headers from logs and debug exports."
        control={<Switch checked={adapter.debugLogging ? true : true} onChange={() => {}} disabled />}
      />
      <SettingRow
        label="Host logs"
        control={<Button size="sm" variant="secondary" iconLeft={<ExternalLink size={14} />} disabled={!isExtension} onClick={() => void openLogs()}>Open log file</Button>}
      />
    </div>
  );
}
