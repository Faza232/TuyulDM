import { useEffect, useRef, useState } from 'react';
import { Dialog, Button, Input, useToast } from '../../../ui/primitives';
import { useDownloads } from '../../../state';

export interface AddUrlDialogProps {
  open: boolean;
  onClose: () => void;
}

function isLikelyUrl(s: string): boolean {
  try {
    const u = new URL(s.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function AddUrlDialog({ open, onClose }: AddUrlDialogProps) {
  const [url, setUrl] = useState('');
  const [filename, setFilename] = useState('');
  const [busy, setBusy] = useState(false);
  const { addDownload } = useDownloads();
  const { push } = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setUrl('');
      setFilename('');
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const valid = isLikelyUrl(url);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await addDownload(url.trim(), filename.trim() || undefined);
      push({ tone: 'success', title: 'Queued', body: filename.trim() || url.trim() });
      onClose();
    } catch (e) {
      push({ tone: 'danger', title: 'Failed to queue', body: String((e as Error)?.message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add URL"
      description="Paste a direct media URL or manifest (m3u8 / mpd)."
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={!valid || busy}>
            {busy ? 'Queueing…' : 'Add'}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-3"
      >
        <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-muted)]">
          URL
          <Input
            ref={inputRef}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/video.m3u8"
            invalid={url.length > 0 && !valid}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-muted)]">
          Filename <span className="text-[var(--color-text-dim)]">(optional)</span>
          <Input
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder="my-video.mp4"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      </form>
    </Dialog>
  );
}
