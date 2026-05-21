import { refusalMessage } from '../../../state/messages';
import { Button } from '../../../ui/primitives';

interface RefusalCellProps {
  reason?: string;
  onAction: (type: string, url?: string) => void;
}

export function RefusalCell({ reason, onAction }: RefusalCellProps) {
  const msg = refusalMessage(reason);
  
  return (
    <div className="flex items-center gap-4 text-[13px]">
      <div className="flex flex-col">
        <span className="text-[var(--color-danger)] font-medium">{msg.title}</span>
        {msg.body && <span className="text-[var(--color-text-dim)] text-[11px]">{msg.body}</span>}
      </div>
      {msg.recovery && (
        <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); onAction(msg.recovery!.type, msg.recovery!.url); }}>
          {msg.recovery.label}
        </Button>
      )}
    </div>
  );
}
