import { useEffect, useState } from 'react';
import { Dialog, Button, Input } from '../../../ui/primitives';
import { RefreshCw } from '../../../ui/icons';
import { useDownloads } from '../../../state/store';
import { bridge } from '../../../state/bridge';
import { useToasts } from '../../../state/toast';
import type { DownloadItem } from '../../../state/types';
import { isValidDownloadUrl, getDownloadLabel } from '../../../ui/format';

const FORCE_CODES = new Set(['validators_missing']);
const RESTART_CODES = new Set(['size_mismatch', 'etag_mismatch', 'last_modified_mismatch', 'accept_ranges_required']);

export function RefreshUrlDialog({ download, open, onClose }: { download: DownloadItem | null; open: boolean; onClose: () => void }) {
  const { refreshUrl } = useDownloads();
  const { push } = useToasts();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mismatchCode, setMismatchCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && download) { setUrl(download.url || ''); setError(null); setMismatchCode(null); }
  }, [open, download]);

  if (!download) return <Dialog open={open} onClose={onClose} title="Refresh URL" />;

  const submit = async (opts: { force?: boolean; restartFromScratch?: boolean } = {}) => {
    const next = url.trim();
    if (!isValidDownloadUrl(next)) { setError('Enter a valid http(s) URL.'); return; }
    setBusy(true); setError(null);
    const r = await refreshUrl(download.id, next, opts);
    setBusy(false);
    if (r?.error) {
      setError(r.error);
      setMismatchCode(r.code || null);
      return;
    }
    push({ tone: 'success', title: 'URL refreshed' });
    onClose();
  };

  const useCurrentTab = async () => {
    const r = await bridge.getActiveTabUrl();
    if (r?.error) { setError(r.error); return; }
    const next = String(r?.url || '').trim();
    if (!isValidDownloadUrl(next)) { setError('Current tab URL is not a valid http(s) link.'); return; }
    setUrl(next); setError(null); setMismatchCode(null);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Refresh download URL"
      description={getDownloadLabel(download)}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          {mismatchCode && FORCE_CODES.has(mismatchCode) && (
            <Button variant="secondary" size="sm" loading={busy} onClick={() => void submit({ force: true })}>Force refresh</Button>
          )}
          {mismatchCode && RESTART_CODES.has(mismatchCode) && (
            <Button variant="secondary" size="sm" loading={busy} onClick={() => void submit({ restartFromScratch: true })}>Restart from scratch</Button>
          )}
          <Button variant="primary" size="sm" loading={busy} onClick={() => void submit()}>Refresh</Button>
        </>
      }
    >
      <div className="space-y-2">
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" invalid={!!error} />
        <Button variant="ghost" size="sm" iconLeft={<RefreshCw size={13} />} onClick={() => void useCurrentTab()}>Use current tab URL</Button>
        {error && <p className="text-[12px] text-[var(--color-danger)]">{error}</p>}
      </div>
    </Dialog>
  );
}
