import { AlertTriangle, Lock } from '../../../ui/icons';
import { Button } from '../../../ui/primitives';
import { refusalMessage, errorMessage, recoveryLabel } from '../../../state/messages';
import type { RecoveryAction } from '../../../state/messages';
import type { DownloadItem } from '../../../state/types';

export type RefusalCellProps = {
  download: DownloadItem;
  onRecover: (action: RecoveryAction, download: DownloadItem) => void;
};

export function RefusalCell({ download, onRecover }: RefusalCellProps) {
  const isProtected = download.extraction_strategy === 'unsupported_protected';
  const reasonCode = download.offer_debug?.protected_reason || download.error_code;
  const msg = isProtected ? refusalMessage(reasonCode) : errorMessage(download.error_code);
  const label = recoveryLabel(msg.recovery);

  return (
    <div className="flex items-center gap-3 min-w-0 flex-1">
      <span className="shrink-0 text-[var(--color-warning)]">
        {isProtected ? <Lock size={14} /> : <AlertTriangle size={14} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-[var(--color-text)] truncate">{msg.title}</p>
        <p className="text-[11px] text-[var(--color-text-muted)] truncate">{msg.body}</p>
      </div>
      {label && msg.recovery && (
        <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); onRecover(msg.recovery!, download); }}>
          {label}
        </Button>
      )}
    </div>
  );
}
