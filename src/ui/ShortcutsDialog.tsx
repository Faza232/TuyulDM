import { Dialog } from './primitives';
import { Kbd } from './primitives/Kbd';

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard Shortcuts">
      <div className="flex flex-col gap-6 py-2 px-1">
        
        <div className="flex flex-col gap-2">
          <h3 className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-text-dim)]">Global</h3>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-[var(--color-text)]">Command palette</span>
            <span className="flex gap-1"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-[var(--color-text)]">Toggle sidebar</span>
            <Kbd>[</Kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-[var(--color-text)]">Show this cheat sheet</span>
            <Kbd>?</Kbd>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-text-dim)]">Navigation</h3>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-[var(--color-text)]">Queue</span>
            <span className="flex gap-1"><Kbd>G</Kbd><Kbd>Q</Kbd></span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-[var(--color-text)]">Finished</span>
            <span className="flex gap-1"><Kbd>G</Kbd><Kbd>F</Kbd></span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-[var(--color-text)]">Video Grabber</span>
            <span className="flex gap-1"><Kbd>G</Kbd><Kbd>G</Kbd></span>
          </div>
        </div>

      </div>
    </Dialog>
  );
}
