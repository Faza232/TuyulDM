import { Badge, Button } from '../../../ui/primitives';
import { Github, ExternalLink } from '../../../ui/icons';
import { SectionHeader, SettingRow } from './_shared';
import { useSystem } from '../../../state/store';

const REPO = 'https://github.com/husainfaza/TuyulDM';
const VERSION = '0.1.0';

export function About() {
  const { hostStatus } = useSystem();
  return (
    <div>
      <SectionHeader eyebrow="Info" title="About" description="Version and host status." />
      <SettingRow label="Version" control={<span className="font-mono text-[12px] text-[var(--color-text-muted)]">{VERSION}</span>} />
      <SettingRow label="Native host" control={<Badge tone={hostStatus.connected ? 'success' : 'danger'}>{hostStatus.connected ? 'connected' : 'offline'}</Badge>} />
      <SettingRow label="Protocol" control={<span className="font-mono text-[12px] text-[var(--color-text-muted)]">{hostStatus.protocolVersion}</span>} />
      <SettingRow label="Update channel" control={<span className="font-mono text-[12px] text-[var(--color-text-muted)]">stable</span>} />
      <div className="pt-4">
        <Button variant="secondary" size="sm" iconLeft={<Github size={14} />} onClick={() => window.open(REPO, '_blank', 'noopener,noreferrer')}>
          Repository <ExternalLink size={13} />
        </Button>
      </div>
    </div>
  );
}
