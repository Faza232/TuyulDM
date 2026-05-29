import { useEffect, useState } from 'react';
import { Input, Button } from '../../../ui/primitives';
import { FolderOpen } from '../../../ui/icons';
import { SectionHeader, SettingRow } from './_shared';
import { useSettings, useSystem } from '../../../state/store';
import { useToasts } from '../../../state/toast';
import { formatSize } from '../../../ui/format';

export function Storage() {
  const { hostSettings, persistHostSettings, pickDownloadDirectory } = useSettings();
  const { hostStats } = useSystem();
  const { push } = useToasts();
  const [dir, setDir] = useState(hostSettings.downloadDir);

  useEffect(() => { setDir(hostSettings.downloadDir); }, [hostSettings.downloadDir]);

  const commit = async () => {
    const r = await persistHostSettings({ downloadDir: dir.trim() });
    if (!r?.error) push({ tone: 'success', title: 'Saved' });
  };

  return (
    <div>
      <SectionHeader eyebrow="Disk" title="Storage" description="Where downloads are saved." />
      <div className="py-3 border-b border-[var(--color-border-subtle)]">
        <label className="text-[13px] text-[var(--color-text)]">Download folder</label>
        <div className="flex items-center gap-2 mt-2">
          <Input value={dir} onChange={(e) => setDir(e.target.value)} onBlur={() => void commit()} placeholder="/home/you/Downloads" className="flex-1" />
          <Button size="sm" variant="secondary" iconLeft={<FolderOpen size={14} />} onClick={() => void pickDownloadDirectory()}>Browse</Button>
        </div>
      </div>
      <SettingRow label="Free disk space" control={<span className="font-mono text-[12px] text-[var(--color-text-muted)]">{hostStats.freeSpaceBytes ? formatSize(hostStats.freeSpaceBytes) : 'unknown'}</span>} />
    </div>
  );
}
