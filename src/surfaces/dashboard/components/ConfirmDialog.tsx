import { Dialog, Button } from '../../../ui/primitives';
import { useDialogs } from '../../../state/dialogs';

export function ConfirmDialog() {
  const { confirm, resolveConfirm, dismissConfirm } = useDialogs();
  const open = confirm !== null;

  return (
    <Dialog
      open={open}
      onClose={dismissConfirm}
      title={confirm?.title ?? ''}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={dismissConfirm}>
            {confirm?.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            variant={confirm?.tone === 'danger' ? 'danger' : 'primary'}
            size="sm"
            onClick={resolveConfirm}
          >
            {confirm?.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }
    >
      {confirm?.body ? (
        <p className="text-[13px] text-[var(--color-text-muted)]">{confirm.body}</p>
      ) : null}
    </Dialog>
  );
}
