import { Switch, Input, Button } from '../../../ui/primitives';
import { SectionHeader, SettingRow } from './_shared';
import { usePreferences } from '../../../state/preferences';
import { useToasts } from '../../../state/toast';
import { bridge } from '../../../state/bridge';

export function Adapters() {
  const { adapter, setAdapter } = usePreferences();
  const { push } = useToasts();

  // adapter.probe IPC is not yet implemented by the native host; probe is
  // best-effort and reports honestly when unavailable.
  const probe = async () => {
    if (!bridge.isExtension()) { push({ tone: 'warning', title: 'Probe needs the native host' }); return; }
    push({ tone: 'info', title: 'Probe unavailable', body: 'Native host does not expose adapter.probe yet.' });
  };

  return (
    <div>
      <SectionHeader eyebrow="Resolvers" title="Adapters" description="External media resolver configuration." />
      <SettingRow
        label="Enable external resolver"
        description="Use an external binary to resolve protected or complex media."
        control={<Switch checked={adapter.resolverEnabled} onChange={(v) => setAdapter({ resolverEnabled: v })} />}
      />
      <SettingRow
        label="Binary path"
        description="Absolute path to the resolver executable."
        control={
          <span className="flex items-center gap-2">
            <Input value={adapter.binaryPath} onChange={(e) => setAdapter({ binaryPath: e.target.value })} placeholder="/usr/local/bin/resolver" className="w-56" />
            <Button size="sm" variant="secondary" onClick={() => void probe()}>Probe</Button>
          </span>
        }
      />
      <SettingRow
        label="Resolve timeout (ms)"
        control={<Input type="number" min={1000} value={adapter.resolveTimeoutMs} onChange={(e) => setAdapter({ resolveTimeoutMs: Number(e.target.value) })} className="w-28" />}
      />
      <SettingRow
        label="Adapter debug logging"
        control={<Switch checked={adapter.debugLogging} onChange={(v) => setAdapter({ debugLogging: v })} />}
      />
    </div>
  );
}
