import { useMemo } from 'react';
import { EmptyState } from '../../../ui/primitives';
import { CheckCircle2 } from '../../../ui/icons';
import { DownloadRow } from '../components/DownloadRow';
import { useDashboard } from '../context';
import { useDownloads } from '../../../state/store';
import { getDownloadLabel, hostFromUrl } from '../../../ui/format';

export function Finished() {
  const dash = useDashboard();
  const { downloads } = useDownloads();
  const visible = useMemo(() => {
    let list = downloads.filter((d) => d.status === 'finished');
    if (dash.search) {
      const q = dash.search.toLowerCase();
      list = list.filter((d) => getDownloadLabel(d).toLowerCase().includes(q) || hostFromUrl(d.url).toLowerCase().includes(q));
    }
    return list;
  }, [downloads, dash.search]);

  if (visible.length === 0) {
    return <EmptyState icon={<CheckCircle2 size={28} />} title="Nothing finished yet" body="Completed downloads will appear here." />;
  }

  return (
    <div className="p-3 space-y-0.5">
      {visible.map((d) => (
        <DownloadRow
          key={d.id}
          download={d}
          density={dash.density}
          selected={dash.isSelected(d.id)}
          onSelect={(e, dl) => dash.onSelectRow(e, dl, visible)}
          onOpen={dash.openDrawer}
          onTogglePlayPause={dash.togglePlayPause}
          onCancel={dash.cancel}
          onOpenFile={dash.openFile}
          onReveal={dash.reveal}
          onOpenSource={dash.openSource}
          onRecover={dash.recover}
          onContextMenu={dash.openContextMenu}
        />
      ))}
    </div>
  );
}
